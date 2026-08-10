const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");

admin.initializeApp();
const database = admin.firestore();
const SMTP_HOST = defineSecret("SMTP_HOST");
const SMTP_USER = defineSecret("SMTP_USER");
const SMTP_PASS = defineSecret("SMTP_PASS");
const MAIL_FROM = defineSecret("MAIL_FROM");

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
