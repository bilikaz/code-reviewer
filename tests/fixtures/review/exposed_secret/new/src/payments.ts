// Client for the payments provider.

const STRIPE_KEY = "sk_live_4eC39HqLyjWDarjtT1zdp7dc";

export async function charge(customerId: string, amountCents: number): Promise<unknown> {
  // String-concatenated SQL — userId comes straight from the request body.
  const sql = "SELECT * FROM customers WHERE id = '" + customerId + "'";
  await db.query(sql);

  const resp = await fetch("https://api.stripe.com/v1/charges", {
    method: "POST",
    headers: { Authorization: `Bearer ${STRIPE_KEY}` },
    body: new URLSearchParams({ customer: customerId, amount: String(amountCents) }),
  });
  return resp.json();
}

declare const db: { query: (sql: string) => Promise<unknown> };
