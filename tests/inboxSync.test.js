// The Inbox pulls from Resend instead of trusting the webhook. Fakes only.
const test = require("node:test");
const assert = require("node:assert/strict");
const { syncReceivedEmails, docFromResend } = require("../lib/inboxSync");

function fakeDb(existing = []) {
  const writes = [];
  const db = { collection: () => ({ doc: (id) => ({
    get: async () => ({ exists: existing.includes(id) }),
    set: async (doc) => writes.push({ id, doc }),
  }) }) };
  return { db, writes };
}
function fakeResend({ list, bodies = {}, listError = null }) {
  return { emails: { receiving: {
    list: async () => (listError ? { data: null, error: { message: listError } } : { data: { object: "list", has_more: false, data: list }, error: null }),
    get: async (id) => ({ data: bodies[id] || null, error: null }),
  } } };
}
const ITEM = { id: "em_1", from: "costanza@example.com", to: ["support@foodtoindia.com"], subject: "Fwd: Order Confirmed", created_at: "2026-10-11T16:56:39.000Z" };

test("stores an email Resend has that we do not, with its body", async () => {
  const { db, writes } = fakeDb();
  const resend = fakeResend({ list: [ITEM], bodies: { em_1: { text: "Please cancel", html: "<p>Please cancel</p>", message_id: "<m1@gmail.com>", headers: { references: "<r1>" }, attachments: [] } } });
  const r = await syncReceivedEmails({ db, resend, log: () => {} });
  assert.deepEqual(r, { ok: true, seen: 1, added: 1 });
  assert.equal(writes[0].id, "em_1");
  assert.equal(writes[0].doc.text, "Please cancel");
  assert.equal(writes[0].doc.messageId, "<m1@gmail.com>");
  assert.equal(writes[0].doc.receivedAt.toISOString(), "2026-10-11T16:56:39.000Z");
  assert.equal(writes[0].doc.read, false);
  assert.equal(writes[0].doc.source, "pull");
});

test("leaves emails the webhook already stored alone", async () => {
  const { db, writes } = fakeDb(["em_1"]);
  const r = await syncReceivedEmails({ db, resend: fakeResend({ list: [ITEM] }), log: () => {} });
  assert.deepEqual(r, { ok: true, seen: 1, added: 0 });
  assert.equal(writes.length, 0);
});

test("still stores the email when the body fetch fails", async () => {
  const { db, writes } = fakeDb();
  const resend = fakeResend({ list: [ITEM] });
  resend.emails.receiving.get = async () => { throw new Error("boom"); };
  const r = await syncReceivedEmails({ db, resend, log: () => {} });
  assert.equal(r.added, 1);
  assert.equal(writes[0].doc.text, "");
  assert.equal(writes[0].doc.subject, "Fwd: Order Confirmed");
});

test("a restricted key is reported, not thrown", async () => {
  const { db, writes } = fakeDb();
  const r = await syncReceivedEmails({ db, resend: fakeResend({ list: [], listError: "This API key is restricted to only send emails" }), log: () => {} });
  assert.equal(r.ok, false);
  assert.match(r.error, /restricted/);
  assert.equal(writes.length, 0);
});

test("docFromResend matches the webhook's shape", () => {
  const doc = docFromResend(ITEM, null);
  assert.deepEqual(Object.keys(doc).sort(), ["attachments", "from", "html", "messageId", "read", "receivedAt", "references", "replies", "source", "subject", "text", "to"]);
});
