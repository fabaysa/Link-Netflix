import test from "node:test";
import assert from "node:assert/strict";
import {
  activateUserVip,
  revokeUserVip,
  extendUserVip,
  listVipUsers,
  getUserByIdOrUsername,
  checkUserWarranty,
  addPackage
} from "../lib/store.js";

test("admin vip activation, listing, extension, and revocation", async () => {
  const testUserId = 88997711;
  const testUsername = "vipuser_tester";

  // 1. Initial check - user has no VIP
  const initialWarranty = await checkUserWarranty(testUserId);
  assert.equal(initialWarranty.hasActiveWarranty, false);

  // 2. Admin activates 30 days VIP
  const actRes = await activateUserVip({
    userId: testUserId,
    username: testUsername,
    firstName: "Tester",
    durationDays: 30,
    dailyLimit: 10,
    packageName: "VIP 30 Hari Premium"
  });

  assert.equal(actRes.ok, true);
  assert.equal(actRes.user.telegram_user_id, testUserId);
  assert.equal(actRes.user.warranty_daily_limit, 10);
  assert.equal(actRes.user.warranty_lifetime, false);
  assert.ok(actRes.expiresAt !== null);

  // 3. User warranty check now active
  const activeWarranty = await checkUserWarranty(testUserId);
  assert.equal(activeWarranty.hasActiveWarranty, true);
  assert.equal(activeWarranty.isLifetime, false);
  assert.equal(activeWarranty.dailyLimit, 10);
  assert.equal(activeWarranty.packageName, "VIP 30 Hari Premium");

  // 4. Resolve user by @username and by numeric ID
  const foundByAt = await getUserByIdOrUsername(`@${testUsername}`);
  assert.ok(foundByAt);
  assert.equal(String(foundByAt.telegram_user_id), String(testUserId));

  const foundById = await getUserByIdOrUsername(testUserId);
  assert.ok(foundById);
  assert.equal(foundById.username, testUsername);

  // 5. Extend VIP by 15 days
  const extRes = await extendUserVip(testUserId, 15);
  assert.equal(extRes.ok, true);
  assert.ok(new Date(extRes.expiresAt).getTime() > new Date(actRes.expiresAt).getTime());

  // 6. List VIP users - filter active
  const listActive = await listVipUsers({ filter: "active", search: testUsername });
  assert.ok(listActive.users.some((u) => String(u.telegram_user_id) === String(testUserId)));

  // 7. Change to VIP Lifetime
  const lifeRes = await activateUserVip({
    userId: testUserId,
    lifetime: true,
    packageName: "VIP Lifetime"
  });
  assert.equal(lifeRes.user.warranty_lifetime, true);
  assert.equal(lifeRes.user.warranty_expires_at, null);

  const lifeWarranty = await checkUserWarranty(testUserId);
  assert.equal(lifeWarranty.hasActiveWarranty, true);
  assert.equal(lifeWarranty.isLifetime, true);

  // 8. List VIP users - filter lifetime
  const listLife = await listVipUsers({ filter: "lifetime" });
  assert.ok(listLife.users.some((u) => String(u.telegram_user_id) === String(testUserId)));

  // 9. Admin revokes VIP
  const revRes = await revokeUserVip(testUserId);
  assert.equal(revRes.ok, true);
  assert.equal(revRes.user.warranty_lifetime, false);
  assert.equal(revRes.user.warranty_expires_at, null);

  const revokedWarranty = await checkUserWarranty(testUserId);
  assert.equal(revokedWarranty.hasActiveWarranty, false);

  // 10. Activate VIP using Package ID
  const pkg = await addPackage({
    name: "VIP 7 Hari Starter",
    price: 15000,
    durationDays: 7,
    dailyLimit: 3
  });

  const pkgRes = await activateUserVip({
    userId: testUserId,
    packageId: pkg.id
  });
  assert.equal(pkgRes.user.warranty_package_name, "VIP 7 Hari Starter");
  assert.equal(pkgRes.user.warranty_daily_limit, 3);
  assert.ok(pkgRes.expiresAt !== null);

  // Clean up
  await revokeUserVip(testUserId);
});
