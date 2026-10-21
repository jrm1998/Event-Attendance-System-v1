/**
 * Creates or resets an administrator account.
 *   npm run create-admin -- --username admin2 --email admin2@sample.edu
 * Password is prompted, or passed via ADMIN_PASSWORD env var.
 */
require('dotenv').config();
const readline = require('readline');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const config = require('../src/config/environment');

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const getArg = (name) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };

  const username = getArg('username') || 'admin';
  const email = getArg('email') || `${username}@sample.edu`;
  const password = process.env.ADMIN_PASSWORD || (await ask(`Password for "${username}" (min 10 chars): `));

  if (!password || password.length < 10) {
    console.error('Password must be at least 10 characters.');
    process.exit(1);
  }
  if (!/^[a-zA-Z0-9._-]{3,50}$/.test(username)) {
    console.error('Username must be 3-50 characters: letters, digits, dot, underscore, hyphen.');
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 12);
  const connection = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    timezone: 'Z',
  });

  try {
    const [existing] = await connection.query('SELECT id FROM users WHERE username = ?', [username]);
    if (existing.length) {
      await connection.query('UPDATE users SET password_hash = ?, role = "admin", status = "active" WHERE id = ?', [hash, existing[0].id]);
      console.log(`Updated existing admin account "${username}".`);
    } else {
      await connection.query(
        'INSERT INTO users (username, email, password_hash, role, status) VALUES (?, ?, ?, "admin", "active")',
        [username, email, hash]
      );
      console.log(`Created admin account "${username}".`);
    }
  } finally {
    await connection.end();
  }
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
