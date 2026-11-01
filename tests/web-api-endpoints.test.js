import test from "node:test";
import assert from "node:assert/strict";
import claimStatusHandler from "../api/claim-status.js";
import redeemHandler from "../api/redeem.js";
import claimHandler from "../api/claim.js";
import { createVouchers, setSetting } from "../lib/store.js";

function createMockReqRes({ method = "GET", query = {}, body = {} } = {}) {
  const req = {
    method,
    query,
    body,
    headers: {}
  };
  const res = {
    statusCode: 200,
    headers: {},
    bodyData: null,
    setHeader(key, val) {
      this.headers[key] = val;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.bodyData = data;
      return this;
    },
    end() {
      return this;
    }
  };
  return { req, res };
}

test("API: claim-status returns packages and supportUsername when requested", async () => {
  const { req, res } = createMockReqRes({
    method: "GET",
    query: { packages: "1" }
  });
  await claimStatusHandler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.bodyData.ok, true);
  assert.ok(Array.isArray(res.bodyData.packages));
  assert.ok(res.bodyData.supportUsername);
});

test("API: redeem and claim endpoints handle flow", async () => {
  // 1. Create a 30-day voucher
  const vouchers = await createVouchers({ packageId: "30_hari", count: 1 });
  const code = vouchers[0].raw_code;

  // 2. Check claim-status for unredeemed code
  const { req: sReq1, res: sRes1 } = createMockReqRes({
    method: "GET",
    query: { code }
  });
  await claimStatusHandler(sReq1, sRes1);
  assert.equal(sRes1.statusCode, 200);
  assert.equal(sRes1.bodyData.needsActivation, true);

  // 3. Redeem via POST /api/redeem
  const { req: rReq, res: rRes } = createMockReqRes({
    method: "POST",
    body: { code }
  });
  await redeemHandler(rReq, rRes);
  assert.equal(rRes.statusCode, 200);
  assert.equal(rRes.bodyData.ok, true);
  assert.equal(rRes.bodyData.status.hasActiveWarranty, true);

  // 4. Submit claim via POST /api/claim
  // Set require_warranty to false or ensure warranty is active
  await setSetting("require_warranty", true);
  const { req: cReq, res: cRes } = createMockReqRes({
    method: "POST",
    body: { code, mode: "baru" }
  });
  await claimHandler(cReq, cRes);
  assert.equal(cRes.statusCode, 202);
  assert.equal(cRes.bodyData.ok, true);
  assert.ok(cRes.bodyData.jobId);
  assert.equal(cRes.bodyData.mode, "baru");
});

