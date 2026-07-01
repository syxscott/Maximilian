/**
 * Phase 9 — Database Benchmark Tasks.
 *
 * 3 highly tricky SQL generation/optimization tasks.
 * Each task has:
 *   - Real DDL to initialize an in-memory SQLite sandbox
 *   - A gold-standard query that produces the correct result
 *   - The expected result rows (computed from the gold query)
 *   - An async assertion function for flexible validation
 *
 * These are NOT toy queries. They test recursive CTEs, window functions,
 * and multi-table JOIN optimization.
 */

import type { BenchmarkTask, DatabaseTaskContext } from "../../packages/benchmark-core/src/types.js";

// ── Task 1: Recursive CTE — Employee Hierarchy ──────────────────────────────

const task1Context: DatabaseTaskContext = {
  ddl: `
    CREATE TABLE employees (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      manager_id INTEGER REFERENCES employees(id),
      department TEXT NOT NULL,
      salary INTEGER NOT NULL
    );

    INSERT INTO employees (id, name, manager_id, department, salary) VALUES
      (1, 'Alice',   NULL, 'Executive', 200000),
      (2, 'Bob',     1,    'Engineering', 150000),
      (3, 'Charlie', 1,    'Marketing',  120000),
      (4, 'Diana',   2,    'Engineering', 130000),
      (5, 'Eve',     2,    'Engineering', 125000),
      (6, 'Frank',   3,    'Marketing',  110000),
      (7, 'Grace',   4,    'Engineering', 115000),
      (8, 'Hank',    4,    'Engineering', 105000),
      (9, 'Ivy',     6,    'Marketing',   95000),
      (10, 'Jack',   NULL, 'Support',     90000);
  `,
  goldQuery: `
    WITH RECURSIVE reports AS (
      SELECT id, name, manager_id, department, salary, 0 AS depth
      FROM employees
      WHERE id = 2

      UNION ALL

      SELECT e.id, e.name, e.manager_id, e.department, e.salary, r.depth + 1
      FROM employees e
      INNER JOIN reports r ON e.manager_id = r.id
    )
    SELECT name, department, salary, depth
    FROM reports
    ORDER BY depth, name;
  `,
  goldResult: [
    { name: "Bob", department: "Engineering", salary: 150000, depth: 0 },
    { name: "Diana", department: "Engineering", salary: 130000, depth: 1 },
    { name: "Eve", department: "Engineering", salary: 125000, depth: 1 },
    { name: "Grace", department: "Engineering", salary: 115000, depth: 2 },
    { name: "Hank", department: "Engineering", salary: 105000, depth: 2 },
  ],
};

// ── Task 2: Window Functions — Running Totals with Gaps ─────────────────────

const task2Context: DatabaseTaskContext = {
  ddl: `
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY,
      txn_date TEXT NOT NULL,
      amount REAL NOT NULL,
      category TEXT NOT NULL
    );

    INSERT INTO transactions (id, txn_date, amount, category) VALUES
      (1,  '2024-01-01',  100.00, 'sales'),
      (2,  '2024-01-01',  -50.00, 'returns'),
      (3,  '2024-01-03',  200.00, 'sales'),
      (4,  '2024-01-03',   75.00, 'sales'),
      (5,  '2024-01-05', -150.00, 'returns'),
      (6,  '2024-01-07',  300.00, 'sales'),
      (7,  '2024-01-07',  -25.00, 'returns'),
      (8,  '2024-01-10',  400.00, 'sales'),
      (9,  '2024-01-10',  100.00, 'sales'),
      (10, '2024-01-12',  -50.00, 'returns');
  `,
  goldQuery: `
    SELECT
      txn_date,
      category,
      amount,
      SUM(CASE WHEN category = 'sales' THEN amount ELSE 0 END)
        OVER (ORDER BY txn_date, id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
        AS cumulative_sales,
      ABS(SUM(CASE WHEN category = 'returns' THEN amount ELSE 0 END)
        OVER (ORDER BY txn_date, id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW))
        AS cumulative_returns,
      SUM(amount)
        OVER (ORDER BY txn_date, id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
        AS cumulative_net
    FROM transactions
    ORDER BY txn_date, id;
  `,
  goldResult: [
    { txn_date: "2024-01-01", category: "sales", amount: 100, cumulative_sales: 100, cumulative_returns: 0, cumulative_net: 100 },
    { txn_date: "2024-01-01", category: "returns", amount: -50, cumulative_sales: 100, cumulative_returns: 50, cumulative_net: 50 },
    { txn_date: "2024-01-03", category: "sales", amount: 200, cumulative_sales: 300, cumulative_returns: 50, cumulative_net: 250 },
    { txn_date: "2024-01-03", category: "sales", amount: 75, cumulative_sales: 375, cumulative_returns: 50, cumulative_net: 325 },
    { txn_date: "2024-01-05", category: "returns", amount: -150, cumulative_sales: 375, cumulative_returns: 200, cumulative_net: 175 },
    { txn_date: "2024-01-07", category: "sales", amount: 300, cumulative_sales: 675, cumulative_returns: 200, cumulative_net: 475 },
    { txn_date: "2024-01-07", category: "returns", amount: -25, cumulative_sales: 675, cumulative_returns: 225, cumulative_net: 450 },
    { txn_date: "2024-01-10", category: "sales", amount: 400, cumulative_sales: 1075, cumulative_returns: 225, cumulative_net: 850 },
    { txn_date: "2024-01-10", category: "sales", amount: 100, cumulative_sales: 1175, cumulative_returns: 225, cumulative_net: 950 },
    { txn_date: "2024-01-12", category: "returns", amount: -50, cumulative_sales: 1175, cumulative_returns: 275, cumulative_net: 900 },
  ],
};

// ── Task 3: Multi-Table JOIN Optimization ────────────────────────────────────

const task3Context: DatabaseTaskContext = {
  ddl: `
    CREATE TABLE customers (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      tier TEXT NOT NULL DEFAULT 'standard'
    );

    CREATE TABLE products (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      price REAL NOT NULL
    );

    CREATE TABLE orders (
      id INTEGER PRIMARY KEY,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      order_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
    );

    CREATE TABLE order_items (
      id INTEGER PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES orders(id),
      product_id INTEGER NOT NULL REFERENCES products(id),
      quantity INTEGER NOT NULL,
      unit_price REAL NOT NULL
    );

    INSERT INTO customers (id, name, tier) VALUES
      (1, 'Acme Corp', 'premium'),
      (2, 'Beta Inc', 'standard'),
      (3, 'Gamma LLC', 'premium'),
      (4, 'Delta Co', 'standard');

    INSERT INTO products (id, name, category, price) VALUES
      (1, 'Widget A', 'widgets', 10.00),
      (2, 'Widget B', 'widgets', 15.00),
      (3, 'Gadget X', 'gadgets', 50.00),
      (4, 'Gadget Y', 'gadgets', 75.00),
      (5, 'Service Z', 'services', 200.00);

    INSERT INTO orders (id, customer_id, order_date, status) VALUES
      (1, 1, '2024-01-15', 'completed'),
      (2, 1, '2024-02-20', 'completed'),
      (3, 2, '2024-01-25', 'completed'),
      (4, 3, '2024-03-10', 'pending'),
      (5, 3, '2024-03-15', 'completed'),
      (6, 4, '2024-02-01', 'cancelled'),
      (7, 4, '2024-03-20', 'completed');

    INSERT INTO order_items (id, order_id, product_id, quantity, unit_price) VALUES
      (1,  1, 1, 10, 10.00),
      (2,  1, 3,  2, 50.00),
      (3,  2, 4,  1, 75.00),
      (4,  2, 5,  1, 200.00),
      (5,  3, 1,  5, 10.00),
      (6,  3, 2,  3, 15.00),
      (7,  4, 3,  4, 50.00),
      (8,  4, 4,  2, 75.00),
      (9,  5, 5,  1, 200.00),
      (10, 5, 1, 20, 10.00),
      (11, 6, 2, 10, 15.00),
      (12, 7, 3,  3, 50.00),
      (13, 7, 5,  2, 200.00);
  `,
  goldQuery: `
    SELECT
      c.name AS customer_name,
      c.tier,
      COUNT(DISTINCT o.id) AS total_orders,
      SUM(oi.quantity * oi.unit_price) AS total_spent,
      COUNT(DISTINCT p.category) AS categories_purchased,
      GROUP_CONCAT(DISTINCT p.category) AS category_list
    FROM customers c
    INNER JOIN orders o ON o.customer_id = c.id AND o.status = 'completed'
    INNER JOIN order_items oi ON oi.order_id = o.id
    INNER JOIN products p ON p.id = oi.product_id
    GROUP BY c.id, c.name, c.tier
    HAVING total_spent > 100
    ORDER BY total_spent DESC;
  `,
  goldResult: [
    {
      customer_name: "Delta Co",
      tier: "standard",
      total_orders: 1,
      total_spent: 550.0,
      categories_purchased: 2,
      category_list: "gadgets,services",
    },
    {
      customer_name: "Acme Corp",
      tier: "premium",
      total_orders: 2,
      total_spent: 475.0,
      categories_purchased: 3,
      category_list: "widgets,gadgets,services",
    },
    {
      customer_name: "Gamma LLC",
      tier: "premium",
      total_orders: 1,
      total_spent: 400.0,
      categories_purchased: 2,
      category_list: "services,widgets",
    },
  ],
};

// ── Assertion Functions ──────────────────────────────────────────────────────

async function assertRecursiveCte(output: string): Promise<boolean> {
  // Must contain a WITH RECURSIVE keyword (case-insensitive).
  if (!/WITH\s+RECURSIVE/i.test(output)) return false;
  // Must reference the employees table.
  if (!/employees/i.test(output)) return false;
  // Must have a UNION ALL (recursive CTE requirement).
  if (!/UNION\s+ALL/i.test(output)) return false;
  return true;
}

async function assertWindowFunction(output: string): Promise<boolean> {
  // Must use a window function (SUM ... OVER or similar).
  if (!/OVER\s*\(/i.test(output)) return false;
  // Must reference the transactions table.
  if (!/transactions/i.test(output)) return false;
  // Must use ORDER BY in the window.
  if (!/ORDER\s+BY/i.test(output)) return false;
  return true;
}

async function assertJoinOptimization(output: string): Promise<boolean> {
  // Must use JOIN (not subqueries for each row).
  if (!/JOIN/i.test(output)) return false;
  // Must reference at least 3 tables (customers, orders, order_items or products).
  const tables = ["customers", "orders", "order_items", "products"];
  const referenced = tables.filter((t) => new RegExp(t, "i").test(output));
  if (referenced.length < 3) return false;
  // Must use GROUP BY (aggregation required).
  if (!/GROUP\s+BY/i.test(output)) return false;
  return true;
}

// ── Exported Tasks ───────────────────────────────────────────────────────────

export const DATABASE_TASKS: BenchmarkTask[] = [
  {
    id: "db-recursive-cte-hierarchy",
    domain: "database",
    difficulty: "hard",
    input:
      "Given an employees table with self-referencing manager_id, write a SQL query using a recursive CTE that finds all direct and indirect reports of employee with id=2 (Bob). " +
      "Return their name, department, salary, and depth level in the hierarchy. Order by depth then name.",
    context: task1Context as unknown as Record<string, unknown>,
    expectedOutputAssertion: assertRecursiveCte,
  },
  {
    id: "db-window-running-totals",
    domain: "database",
    difficulty: "hard",
    input:
      "Given a transactions table with date gaps (not every date has transactions), write a SQL query using window functions that computes: " +
      "for each transaction, the running total of sales amount, running total of returns amount, and net running total (sales - returns). " +
      "The running totals must accumulate in date+id order. Return txn_date, category, amount, cumulative_sales, cumulative_returns, cumulative_net.",
    context: task2Context as unknown as Record<string, unknown>,
    expectedOutputAssertion: assertWindowFunction,
  },
  {
    id: "db-join-optimization",
    domain: "database",
    difficulty: "medium",
    input:
      "Given tables: customers, orders, order_items, and products — write a single optimized SQL query (no subqueries in WHERE clause) that shows: " +
      "customer name, tier, total completed orders, total amount spent, number of distinct product categories purchased, and a comma-separated list of those categories. " +
      "Only include customers who spent more than $100. Order by total spent descending.",
    context: task3Context as unknown as Record<string, unknown>,
    expectedOutputAssertion: assertJoinOptimization,
  },
];
