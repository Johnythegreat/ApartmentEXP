const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");

admin.initializeApp();
const database = admin.firestore();
const SMTP_HOST = defineSecret("SMTP_HOST");
const SMTP_USER = defineSecret("SMTP_USER");
const SMTP_PASS = defineSecret("SMTP_PASS");
const MAIL_FROM = defineSecret("MAIL_FROM");
const TELEGRAM_BOT_TOKEN = defineSecret("TELEGRAM_BOT_TOKEN");
const TELEGRAM_CHAT_ID = defineSecret("TELEGRAM_CHAT_ID");

const TELEGRAM_BACKUP_MAX_BYTES = 45 * 1024 * 1024;

function backupDateInManila(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

async function sendTelegramDocument({ token, chatId, filename, contents, caption }) {
  const bytes = Buffer.from(contents, "utf8");
  if (bytes.byteLength > TELEGRAM_BACKUP_MAX_BYTES) {
    throw new Error(`Telegram backup is too large (${bytes.byteLength} bytes).`);
  }
  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("caption", caption.slice(0, 1024));
  form.append("document", new Blob([bytes], { type: "application/json" }), filename);
  const response = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
    method: "POST",
    body: form
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok) {
    throw new Error(`Telegram rejected the backup: ${result?.description || response.statusText || response.status}`);
  }
}

exports.sendDailyTelegramBackup = onSchedule({
  schedule: "0 2 * * *",
  timeZone: "Asia/Manila",
  retryCount: 3,
  secrets: [TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID]
}, async () => {
  const snapshot = await database.collection("apartments").get();
  const exportedAt = new Date();
  const backup = {
    app: "Apartment Amotan Tracker",
    version: 1,
    exportedAt: exportedAt.toISOString(),
    projectId: process.env.GCLOUD_PROJECT || null,
    workspaceCount: snapshot.size,
    workspaces: snapshot.docs.map((document) => ({
      id: document.id,
      data: document.data()
    }))
  };
  const date = backupDateInManila(exportedAt);
  await sendTelegramDocument({
    token: TELEGRAM_BOT_TOKEN.value(),
    chatId: TELEGRAM_CHAT_ID.value(),
    filename: `apartment-tracker-backup-${date}.json`,
    contents: JSON.stringify(backup, null, 2),
    caption: `Daily Apartment Tracker backup for ${date} (${snapshot.size} workspace${snapshot.size === 1 ? "" : "s"}).`
  });
  console.info(`Daily Telegram backup sent for ${snapshot.size} workspace(s).`);
});

exports.createWorkspaceAccount = onCall(async (request) => {
  if (!request.auth || request.auth.token.admin !== true) {
    throw new HttpsError("permission-denied", "Only the platform administrator can create apartment workspaces.");
  }
  const name = String(request.data?.name || "").trim().slice(0, 80);
  const slug = String(request.data?.slug || "").trim().toLowerCase();
  const email = String(request.data?.email || "").trim().toLowerCase();
  const password = String(request.data?.password || "");
  if (!name) throw new HttpsError("invalid-argument", "Enter an apartment name.");
  if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(slug) || slug === "main") {
    throw new HttpsError("invalid-argument", "Use a unique 3–40 character workspace name containing lowercase letters, numbers, and hyphens.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpsError("invalid-argument", "Enter a valid administrator email.");
  if (password.length < 12) throw new HttpsError("invalid-argument", "Use a temporary password with at least 12 characters.");

  const workspaceRef = database.collection("apartments").doc(slug);
  if ((await workspaceRef.get()).exists) throw new HttpsError("already-exists", "That workspace link name is already in use.");

  let user;
  try {
    user = await admin.auth().createUser({ email, password, emailVerified: false });
    await admin.auth().setCustomUserClaims(user.uid, { workspaceId: slug, workspaceAdmin: true });
    await workspaceRef.create({
      members: [], announcements: [], income: [], expenses: [], rooms: [],
      bills: {}, carryover: 0,
      cycleStarted: new Date().toISOString().slice(0, 10),
      settings: { apartmentName: name, autoBackup: { enabled: false, frequency: "weekly", lastRun: null } },
      revision: 1,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: request.auth.uid
    });
  } catch (error) {
    if (user?.uid) await admin.auth().deleteUser(user.uid).catch(() => {});
    if (error.code === "auth/email-already-exists") throw new HttpsError("already-exists", "That email already has a Firebase account.");
    if (error instanceof HttpsError) throw error;
    console.error("Workspace provisioning failed", error);
    throw new HttpsError("internal", "The workspace could not be created.");
  }
  return { workspaceId: slug, email };
});

exports.publishScheduledAnnouncements = onSchedule("every 5 minutes", async () => {
  const due = await database.collection("announcements")
    .where("status", "==", "scheduled")
    .where("scheduledAt", "<=", admin.firestore.Timestamp.now())
    .limit(100)
    .get();
  if (due.empty) return;
  const batch = database.batch();
  for (const snapshot of due.docs) {
    batch.update(snapshot.ref, {
      status: "published",
      publishedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  }
  await batch.commit();
});

exports.sendAnnouncement = onDocumentWritten({
  document: "announcements/{id}",
  secrets: [SMTP_HOST, SMTP_USER, SMTP_PASS, MAIL_FROM]
}, async (event) => {
  const before = event.data.before.data();
  const after = event.data.after.data();
  if (!after || after.status !== "published" || !after.notifyOnPublish || before?.status === "published") return;

  const announcementRef = event.data.after.ref;
  const locked = await database.runTransaction(async (transaction) => {
    const fresh = (await transaction.get(announcementRef)).data();
    if (["sent", "sending"].includes(fresh?.notificationState)) return false;
    transaction.update(announcementRef, { notificationState: "sending", notificationError: admin.firestore.FieldValue.delete() });
    return true;
  });
  if (!locked) return;

  try {
    const subscriptions = await database.collection("announcementSubscriptions").where("status", "==", "active").get();
    const transport = nodemailer.createTransport({
      host: SMTP_HOST.value(), port: 587, secure: false,
      auth: { user: SMTP_USER.value(), pass: SMTP_PASS.value() }
    });
    const subject = String(after.title || "Apartment announcement").replace(/[\r\n]+/g, " ").slice(0, 150);
    const message = String(after.message || "").slice(0, 10000);

    const results = await Promise.allSettled(subscriptions.docs.map(async (subscription) => {
      const key = `${event.params.id}_${subscription.id}`;
      const deliveryRef = database.collection("notificationDeliveries").doc(key);
      if ((await deliveryRef.get()).exists) return;
      await transport.sendMail({
        from: MAIL_FROM.value(), to: subscription.data().email, subject,
        text: `${message}\n\nUnsubscribe: ${subscription.data().unsubscribeUrl || "Contact the administrator."}`
      });
      await deliveryRef.create({
        announcementId: event.params.id,
        subscriptionId: subscription.id,
        sentAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }));
    const failed = results.filter((result) => result.status === "rejected");
    await announcementRef.update({
      notificationState: failed.length ? "partial_failure" : "sent",
      notificationFailureCount: failed.length,
      notifiedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (error) {
    await announcementRef.update({
      notificationState: "failed",
      notificationError: String(error.message || error).slice(0, 500)
    });
    throw error;
  }
});
