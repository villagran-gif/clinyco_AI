// Shared test helpers for support-client tests.
//
// Provides a fetch spy that records (url, method, headers, body) per call
// and replies with a caller-supplied JSON payload.

export function makeFetchStub() {
  const calls = [];
  let nextResponse = { status: 200, body: {} };

  function stub(url, init = {}) {
    calls.push({
      url: String(url),
      method: init.method || "GET",
      headers: { ...(init.headers || {}) },
      body: init.body ?? null
    });
    const { status, body } = nextResponse;
    const raw = typeof body === "string" ? body : JSON.stringify(body);
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      async text() {
        return raw;
      }
    });
  }

  stub.calls = calls;
  stub.reply = (status, body) => {
    nextResponse = { status, body };
  };
  stub.replyJson = (body) => {
    nextResponse = { status: 200, body };
  };
  return stub;
}

export const ZENDESK_ENV = {
  ZENDESK_SUBDOMAIN: "clinyco",
  ZENDESK_SUPPORT_EMAIL: "ops@clinyco.test",
  ZENDESK_SUPPORT_TOKEN: "zendesk-token"
};

export const SATELLITE_ENV = {
  SUPPORT_SATELLITE_BASE_URL: "https://sell-medinet-backend.onrender.com/support",
  SUPPORT_SATELLITE_API_KEY: "satellite-api-key"
};

// Fixtures mirror Zendesk response shape exactly — the satellite is
// expected to return these same payloads verbatim for the matching
// endpoints.
export const ZENDESK_FIXTURES = {
  user: {
    user: {
      id: 42,
      name: "Jane Doe",
      email: "jane@example.com",
      phone: "+56987654321",
      role: "end-user",
      user_fields: { rut: "13580388-K" }
    }
  },
  identities: {
    identities: [
      { id: 1, type: "email", value: "jane@example.com", verified: true, primary: true },
      { id: 2, type: "phone_number", value: "+56987654321", verified: true, primary: false }
    ],
    count: 2,
    next_page: null,
    previous_page: null
  },
  userSearch: {
    users: [{ id: 42, name: "Jane Doe", email: "jane@example.com" }],
    next_page: null,
    previous_page: null,
    count: 1
  },
  ticket: {
    ticket: {
      id: 7001,
      subject: "Hola",
      description: "Test",
      status: "open",
      requester_id: 42,
      tags: ["whatsapp"]
    },
    audit: {
      id: 9001,
      ticket_id: 7001,
      events: [{ id: 1, type: "Comment", body: "hola" }]
    }
  },
  ticketAudits: {
    audits: [
      { id: 9001, ticket_id: 7001, events: [{ id: 1, type: "Comment", body: "hola" }] }
    ],
    count: 1,
    next_page: null,
    previous_page: null
  },
  ticketComments: {
    comments: [{ id: 1, type: "Comment", body: "hola", public: true, author_id: 42 }],
    count: 1,
    next_page: null,
    previous_page: null
  },
  searchTickets: {
    results: [{ id: 7001, result_type: "ticket", subject: "Hola" }],
    facets: null,
    count: 1,
    next_page: null,
    previous_page: null
  }
};
