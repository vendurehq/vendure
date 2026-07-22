import { CustomScriptDefinition } from '../types';

// language=Lua
const script = `--[[
  Get a page of job ids for the given states, ordered newest-first by creation time,
  optionally filtered by one or more queue names.
    Input:
      KEYS[1]         key prefix (e.g. "bull:vendure-job-queue:")
      ARGV[1]         skip
      ARGV[2]         take
      ARGV[3]         number of queue-name filters (N)
      ARGV[4..3+N]    queue names
      ARGV[4+N..]     job states/types
    Output:
      { totalCount, { id1, id2, ... } }

  The script is read-only: since Redis scripts execute atomically, candidates from
  each state structure are merged and sorted in Lua memory rather than in temporary
  Redis keys. Only the first (skip + take) entries of each structure are fetched, so
  the cost is bounded by the page depth, not the queue length.
]]
local rcall = redis.call
local prefix = KEYS[1]
local skip = tonumber(ARGV[1])
local take = tonumber(ARGV[2])
local numNames = tonumber(ARGV[3])
local names = {}
for i = 4, 3 + numNames do
    table.insert(names, ARGV[i])
end
local states = {}
for i = 4 + numNames, #ARGV do
    table.insert(states, ARGV[i])
end

local needed = skip + take
local total = 0
local candidates = {}
local seen = {}

local function addCandidate(id, timestamp)
    if not seen[id] then
        seen[id] = true
        table.insert(candidates, { id = id, ts = timestamp })
    end
end

-- Reads the creation timestamp from the job's data hash. Returns nil for ids whose
-- job no longer exists (e.g. entries not yet cleaned from an indexed set).
local function getJobTimestamp(id)
    local ts = rcall('HGET', prefix .. id, 'timestamp')
    if ts then
        return tonumber(ts)
    end
    return nil
end

if numNames > 0 then
    -- Name-filtered path: read the indexed sorted sets maintained by the
    -- JobListIndexService, which are uniformly scored by creation timestamp.
    for _, name in ipairs(names) do
        for _, state in ipairs(states) do
            local key = prefix .. 'queue:' .. name .. ':' .. state
            if rcall('TYPE', key).ok == 'zset' then
                total = total + rcall('ZCARD', key)
                local elements = rcall('ZREVRANGE', key, 0, needed - 1, 'WITHSCORES')
                for i = 1, #elements, 2 do
                    addCandidate(elements[i], tonumber(elements[i + 1]))
                end
            end
        end
    end
else
    -- Unfiltered path: read BullMQ's native state structures. Their sorted-set
    -- scores are not comparable across states (finish time vs. encoded delay
    -- vs. priority), so each candidate's creation timestamp is read from its
    -- job hash to give a single consistent ordering.
    for _, state in ipairs(states) do
        local key = prefix .. state
        local keyType = rcall('TYPE', key).ok
        local elements = nil
        if keyType == 'zset' then
            total = total + rcall('ZCARD', key)
            elements = rcall('ZREVRANGE', key, 0, needed - 1)
        elseif keyType == 'list' then
            total = total + rcall('LLEN', key)
            -- Lists hold the newest id at the head
            elements = rcall('LRANGE', key, 0, needed - 1)
        end
        if elements then
            for _, id in ipairs(elements) do
                local ts = getJobTimestamp(id)
                if ts then
                    addCandidate(id, ts)
                end
            end
        end
    end
end

table.sort(candidates, function(a, b)
    if a.ts == b.ts then
        -- Stable tie-break on the (numeric where possible) job id
        local aNum = tonumber(a.id)
        local bNum = tonumber(b.id)
        if aNum and bNum then
            return aNum > bNum
        end
        return tostring(a.id) > tostring(b.id)
    end
    return a.ts > b.ts
end)

local results = {}
for i = skip + 1, math.min(skip + take, #candidates) do
    table.insert(results, candidates[i].id)
end

return { total, results }
`;

export const getJobsByType: CustomScriptDefinition<
    [totalItems: number, jobIds: string[]],
    Array<string | number>
> = {
    script,
    numberOfKeys: 1,
    name: 'getJobsByType',
};
