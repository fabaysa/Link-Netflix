import test from "node:test";
import assert from "node:assert/strict";
import {
  createVouchers,
  getVoucherByCode,
  redeemVoucherForWeb,
  getClaimStatusByCode,
  saveUserLastAccountCookies,
  consumeClaimQuota,
  upsertUser
} from "../lib/store.js";

test("web claim and redeem: full lifecycle with voucher code", async () => {
  // 1. Buat voucher uji coba (paket 30 hari, limit 10x)
  const created = await createVouchers({
    packageId: "30_hari",
    count: 1
  });
  assert.ok(Array.isArray(created) && created.length > 0, "Voucher harus berhasil dibuat");
  const testVoucher = created[0];
  const testCode = testVoucher.raw_code;

  // 2. Cek status sebelum di-redeem
  const unredeemedStatus = await getClaimStatusByCode(testCode);
  assert.equal(unredeemedStatus.ok, true);
  assert.equal(unredeemedStatus.codeType, "voucher_unredeemed");
  assert.equal(unredeemedStatus.needsActivation, true);
  assert.equal(unredeemedStatus.hasActiveWarranty, false);

  // 3. Redeem voucher untuk Web
  const redeemResult = await redeemVoucherForWeb(testCode);
  assert.equal(redeemResult.ok, true, "Redeem web harus berhasil");
  assert.ok(redeemResult.userId, "Web user ID harus dihasilkan");

  // 4. Cek status setelah di-redeem (Kode voucher kini berfungsi sebagai Kunci Lisensi)
  const activeStatus = await getClaimStatusByCode(testCode);
  assert.equal(activeStatus.ok, true);
  assert.equal(activeStatus.codeType, "voucher_active");
  assert.equal(activeStatus.hasActiveWarranty, true);
  assert.equal(activeStatus.isExpired, false);
  assert.equal(activeStatus.dailyLimit, 10);
  assert.equal(activeStatus.claimsToday, 0);
  assert.equal(activeStatus.remainingToday, 10);
  assert.equal(activeStatus.hasSavedAccount, false);

  // 5. Konsumsi kuota klaim 1x
  await consumeClaimQuota(activeStatus.userId);
  const afterQuotaStatus = await getClaimStatusByCode(testCode);
  assert.equal(afterQuotaStatus.claimsToday, 1);
  assert.equal(afterQuotaStatus.remainingToday, 9);

  // 6. Simpan cookies akun terakhir (simulasi hasil generator)
  await saveUserLastAccountCookies(activeStatus.userId, 'NetflixId=sample_web_cookie; Domain=.netflix.com', {
    country: "ID"
  });
  const withSavedAccount = await getClaimStatusByCode(testCode);
  assert.equal(withSavedAccount.hasSavedAccount, true);
  assert.equal(withSavedAccount.savedAccountCountry, "ID");

  // 7. Coba redeem ulang kode yang sama (harus ditolak karena sudah pernah diaktifkan)
  const duplicateRedeem = await redeemVoucherForWeb(testCode);
  assert.equal(duplicateRedeem.ok, false);
  assert.equal(duplicateRedeem.isAlreadyRedeemed, true);
});

test("web claim: checking status using Telegram User ID", async () => {
  const sampleTgId = 7788990011;
  await upsertUser({
    id: sampleTgId,
    first_name: "Test Telegram User",
    username: "test_tg_user"
  });

  const created = await createVouchers({
    packageId: "7_hari",
    count: 1
  });
  const code = created[0].raw_code;

  // Redeem langsung dengan Telegram ID
  const { redeemVoucher } = await import("../lib/store.js");
  const res = await redeemVoucher(sampleTgId, code);
  assert.equal(res.ok, true);

  // Cek status di web menggunakan Telegram ID
  const tgStatus = await getClaimStatusByCode(String(sampleTgId));
  assert.equal(tgStatus.ok, true);
  assert.equal(tgStatus.codeType, "telegram_user");
  assert.equal(tgStatus.userId, sampleTgId);
  assert.equal(tgStatus.hasActiveWarranty, true);
  assert.equal(tgStatus.dailyLimit, 5);
});

test("web claim: non-existent code returns not found", async () => {
  const notFound = await getClaimStatusByCode("NETFLIX-NON-EXISTENT-CODE");
  assert.equal(notFound.ok, false);
  assert.ok(notFound.error.includes("tidak ditemukan"));
});

