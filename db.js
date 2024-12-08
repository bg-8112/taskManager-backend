const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'taskManagerAppDB',
  password: 'Bala@121811',
  port: 5432,
});

module.exports = pool;
