# Vendure Dev Server

This package is not published to npm. It is used in development of the Vendure server and plugins.

### Running

Ensure you have a database running. From the root directory, run:

```bash
docker-compose up -d mariadb
```

To run the server, run the `dev` script. The database configuration can be specified by the `DB=<type>` environment variable:

```bash
cd packages/dev-server

[DB=mysql|postgres|sqlite] bun run dev
```

The default if no db is specified is mysql.

### Populating data

Test data can be populated by running the `populate` script. This uses the same sample data as is used by the Vendure CLI when running `init`, albeit with the additional step of populating some sample customer & address data too.

Specify the database as above to populate that database:

```bash
[DB=mysql|postgres|sqlite] bun run populate
```

## Testing custom ui extension compilation

In order to compile ui extensions within this monorepo, you need to add the following entry to
the [temporary admin ui `tsconfig.json`](./custom-admin-ui/tsconfig.json) file:

```
  "paths": {
      "@vendure/admin-ui/*": ["../../admin-ui/package/*"]
  }
```

## Load testing

This package also contains scripts for load testing the Vendure server. The load testing infrastructure and scripts are located in the [`./load-testing`](./load-testing) directory.

Load testing is done with [k6](https://docs.k6.io/), and to run them you will need k6 installed and (in Windows) available in your PATH environment variable so that it can be run with the command `k6`.

The load tests assume the existence of the following tables in the  database:

* `vendure-load-testing-1000`
* `vendure-load-testing-10000`
* `vendure-load-testing-100000`

The npm scripts `load-test:1k`, `load-test:10k` and `load-test:100k` will populate their respective databases with test data and then run the k6 scripts against them.

## Running individual scripts

An individual test script may be by specifying the script name as an argument:

```
bun run load-test:1k deep-query.js
```

## pg_stat_statements

The following queries can be used when running load tests against postgres to analyze the queries:

```sql
SELECT 
  dbid,
  (total_time / 1000 / 60) as total, 
  (total_time/calls) as avg, 
  calls,
  query 
FROM pg_stat_statements 
WHERE dbid = <db_id>
ORDER BY total DESC 
LIMIT 100;

-- SELECT pg_stat_statements_reset();
```

### Results

The results of the test are saved to the [`./load-testing/results`](./load-testing/results) directory. Each test run creates two files:

* `load-test-<date>-<product-count>.json` Contains a summary of all load tests run
* `load-test-<date>-<product-count>-<script-name>.csv` Contains time-series data which can be used to create charts

Historical benchmark results with charts can be found in [this Google Sheet](https://docs.google.com/spreadsheets/d/1UaNhmokbNmKDehrnh4m9XO6-DJte-AI-l_Lnji47Qn8/edit?usp=sharing)
