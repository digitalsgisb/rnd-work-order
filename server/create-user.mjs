import bcrypt from "bcryptjs";
import pool from "./db.mjs";

const [
  employeeId,
  username,
  fullName,
  department,
  role
] = process.argv.slice(2);

try {
  if (!employeeId || !username || !fullName || !department ||
      !["requester", "approver", "rnd", "head"].includes(role)) {
    throw new Error("Invalid account details");
  }

  let password = "";

  for await (const chunk of process.stdin) {
    password += chunk.toString();
  }

  password = password.replace(/\r?\n$/, "");

  if (password.length < 12 || Buffer.byteLength(password) > 72) {
    throw new Error("Password must be at least 12 characters and at most 72 bytes");
  }

  const dept = await pool.query(
    "SELECT id FROM departments WHERE name = $1",
    [department]
  );

  if (dept.rows.length === 0) {
    throw new Error("Department not found");
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const result = await pool.query(`
    INSERT INTO users (
      employee_id,
      username,
      full_name,
      password_hash,
      department_id,
      role
    )
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id, username, full_name, role
  `, [
    employeeId,
    username,
    fullName,
    passwordHash,
    dept.rows[0].id,
    role
  ]);

  console.log("Account created successfully");
  console.table(result.rows);

} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
