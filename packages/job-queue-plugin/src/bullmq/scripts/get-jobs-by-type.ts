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

  The query reads the indexed sorted sets maintained by the JobListIndexService
  (one per queue name and state, uniformly scored by creation timestamp) rather
  than BullMQ's native state structures. The native structures order by finish
  time, encoded delay or priority depending on the state, so selecting the top
  (skip + take) entries from them could cut a job from the page before a
  creation-time sort ever saw it. When no queue names are given, the registry of
  known queue names is used so that every indexed set is consulted.

  The script is read-only: since Redis scripts execute atomically, candidates are
  merged and sorted in Lua memory rather than in temporary Redis keys. Only the
  first (skip + take) entries of each set are fetched, so the cost is bounded by
  the page depth, not the queue length.
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

if numNames == 0 then
    -- No explicit filter: consult the indexed sets of every known queue name
    names = rcall('SMEMBERS', prefix .. 'queue-names')
end

local needed = skip + take
local total = 0
local candidates = {}
local seen = {}

for _, name in ipairs(names) do
    for _, state in ipairs(states) do
        local key = prefix .. 'queue:' .. name .. ':' .. state
        if rcall('TYPE', key).ok == 'zset' then
            total = total + rcall('ZCARD', key)
            -- Guard against needed <= 0: a range end of -1 would fetch the whole set
            if needed > 0 then
                local elements = rcall('ZREVRANGE', key, 0, needed - 1, 'WITHSCORES')
                for i = 1, #elements, 2 do
                    local id = elements[i]
                    if not seen[id] then
                        seen[id] = true
                        table.insert(candidates, { id = id, ts = tonumber(elements[i + 1]) })
                    end
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
    [skip: number, take: number, numQueueNames: number, ...namesAndStates: string[]]
> = {
    script,
    numberOfKeys: 1,
    name: 'getJobsByType',
};
