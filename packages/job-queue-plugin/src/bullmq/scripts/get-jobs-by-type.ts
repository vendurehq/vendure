import { CustomScriptDefinition } from '../types';

// language=Lua
const script = `--[[
  Get job ids per provided states and filter by name - Optimized version using indexed structure
    Input:
      KEYS[1]    'prefix'
      ARGV[1]    skip
      ARGV[2]    take
      ARGV[3]    filterName
      ARGV[4...] types
]]
local rcall = redis.call
local prefix = KEYS[1]
local skip = tonumber(ARGV[1])
local take = tonumber(ARGV[2])
local filterName = ARGV[3]
local results = {}
local totalResults = 0

-- redis.log(redis.LOG_NOTICE, 'Filter name: "' .. filterName .. '"')
-- redis.log(redis.LOG_NOTICE, 'Filter name length: ' .. tostring(#filterName))
-- redis.log(redis.LOG_NOTICE, 'Number of ARGV: ' .. tostring(#ARGV))
-- redis.log(redis.LOG_NOTICE, 'skip: "' .. tostring(skip) .. '"')
-- redis.log(redis.LOG_NOTICE, 'take: "' .. tostring(take) .. '"')

-- Create a temporary key for merging results
local tempKey = prefix .. 'temp:merge:' .. math.random(1000000)
local sourceKeys = {}
local listKeys = {}

-- Function to count jobs in a sorted set
local function countJobsInSortedSet(key)
    return rcall('ZCARD', key) or 0
end

-- Function to count jobs in a list
local function countJobsInList(key)
    return rcall('LLEN', key) or 0
end

-- First count total jobs and collect source keys
if filterName ~= "" then
    -- When filtering by name, we need to check each state
    for i = 4, #ARGV do
        local state = ARGV[i]
        -- redis.log(redis.LOG_NOTICE, 'Processing state: "' .. state .. '"')
        local indexedKey = prefix .. 'queue:' .. filterName .. ':' .. state
        -- redis.log(redis.LOG_NOTICE, 'Looking for key: ' .. indexedKey)
        local keyType = rcall('TYPE', indexedKey).ok
        -- redis.log(redis.LOG_NOTICE, 'Key type: ' .. keyType)

        if keyType == 'zset' then
            totalResults = totalResults + countJobsInSortedSet(indexedKey)
            table.insert(sourceKeys, indexedKey)
        elseif keyType == 'list' then
            totalResults = totalResults + countJobsInList(indexedKey)
            table.insert(listKeys, indexedKey)
        end
    end
else
    -- No filter, count all types
    for i = 4, #ARGV do
        local state = ARGV[i]
        -- redis.log(redis.LOG_NOTICE, 'Processing state: "' .. state .. '"')
        local key = prefix .. state
        -- redis.log(redis.LOG_NOTICE, 'Looking for key: ' .. key)
        local keyType = rcall('TYPE', key).ok
        -- redis.log(redis.LOG_NOTICE, 'Key type: ' .. keyType)

        if keyType == 'zset' then
            totalResults = totalResults + countJobsInSortedSet(key)
            table.insert(sourceKeys, key)
        elseif keyType == 'list' then
            totalResults = totalResults + countJobsInList(key)
            table.insert(listKeys, key)
            -- redis.log(redis.LOG_NOTICE, 'total jobs in list: ' .. totalResults)
        end
    end
end

-- If we have any sorted sets to merge, do it
if #sourceKeys > 0 then
    -- Calculate how many elements we need to merge
    local neededElements = skip + take
    -- redis.log(redis.LOG_NOTICE, 'Number of source keys: ' .. tostring(#sourceKeys))
    -- redis.log(redis.LOG_NOTICE, 'Needed elements: ' .. tostring(neededElements))

    -- Create temporary keys for each source set with limited elements
    local limitedKeys = {}
    for i, sourceKey in ipairs(sourceKeys) do
        local limitedKey = tempKey .. ':limited:' .. i
        -- redis.log(redis.LOG_NOTICE, 'Processing source key: ' .. sourceKey)
        -- Get only the elements we need from each source set
        local elements = rcall('ZREVRANGE', sourceKey, 0, neededElements - 1, 'WITHSCORES')
        -- redis.log(redis.LOG_NOTICE, 'Found ' .. tostring(#elements) .. ' elements in ' .. sourceKey)
        if #elements > 0 then
            -- Process elements in pairs (member, score)
            local chunkSize = 1000 -- Process in chunks of 1000 elements
            for j = 1, #elements, chunkSize * 2 do
                local chunkEnd = math.min(j + chunkSize * 2 - 1, #elements)
                local chunkArgs = {}
                for k = j, chunkEnd, 2 do
                    local member = elements[k]
                    local score = elements[k + 1]
                    table.insert(chunkArgs, score)
                    table.insert(chunkArgs, member)
                end
                if #chunkArgs > 0 then
                    rcall('ZADD', limitedKey, unpack(chunkArgs))
                end
            end
            table.insert(limitedKeys, limitedKey)
            -- redis.log(redis.LOG_NOTICE, 'Added to limited key: ' .. limitedKey)
        end
    end

    -- redis.log(redis.LOG_NOTICE, 'Number of limited keys: ' .. tostring(#limitedKeys))

    if #limitedKeys > 0 then
        -- Merge the limited sets
        rcall('ZUNIONSTORE', tempKey, #limitedKeys, unpack(limitedKeys))
        -- redis.log(redis.LOG_NOTICE, 'Merged sets into: ' .. tempKey)

        -- Get the paginated results from the merged set
        results = rcall('ZREVRANGE', tempKey, skip, skip + take - 1)
        -- redis.log(redis.LOG_NOTICE, 'Got ' .. tostring(#results) .. ' results from merged set')

        -- Clean up temporary limited keys
        for _, key in ipairs(limitedKeys) do
            rcall('DEL', key)
        end
    else
        -- redis.log(redis.LOG_NOTICE, 'No elements found in any source sets')
    end
end

-- Handle list keys separately
if #listKeys > 0 then
    -- Create a temporary list to merge all list keys
    local tempListKey = tempKey .. ':list'

    -- Merge all list keys into the temporary list
    for _, listKey in ipairs(listKeys) do
        local listElements = rcall('LRANGE', listKey, 0, -1)
        if #listElements > 0 then
            rcall('RPUSH', tempListKey, unpack(listElements))
        end
    end

    -- Get the total number of elements in the merged list
    local totalListElements = rcall('LLEN', tempListKey)

    if totalListElements > 0 then
        -- If we already have results from sorted sets, we need to merge them
        if #results > 0 then
            -- Convert the merged sorted set results to a temporary list
            local tempSortedListKey = tempKey .. ':sorted'
            for _, jobId in ipairs(results) do
                rcall('RPUSH', tempSortedListKey, jobId)
            end

            -- Merge the sorted results with list results
            local sortedElements = rcall('LRANGE', tempSortedListKey, 0, -1)
            rcall('RPUSH', tempListKey, unpack(sortedElements))

            -- Clean up temporary sorted list
            rcall('DEL', tempSortedListKey)
        end

        -- Get the final paginated results from the merged list
        results = rcall('LRANGE', tempListKey, skip, skip + take - 1)

        -- Clean up temporary list
        rcall('DEL', tempListKey)
    end
end

-- Clean up temporary key
rcall('DEL', tempKey)

return {totalResults, results}
`;

export const getJobsByType: CustomScriptDefinition<
    [totalItems: number, jobIds: string[]],
    [skip: number, take: number, queueName: string | undefined, ...states: string[]]
> = {
    script,
    numberOfKeys: 1,
    name: 'getJobsByType',
};
