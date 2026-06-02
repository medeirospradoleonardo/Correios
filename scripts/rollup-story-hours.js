const payload = JSON.parse(
  process.env.WEBHOOK_PAYLOAD || "{}"
);

console.log(
  JSON.stringify(payload, null, 2)
);

const eventType = payload.eventType;

let workItemId;

if (eventType === "workitem.updated") {
  workItemId = payload.resource?.revision?.id;
} else {
  workItemId = payload.resource?.id;
}

console.log("Event:", eventType);
console.log("Work Item:", workItemId);

if (!workItemId) {
  throw new Error("Work Item Id not found in webhook payload.");
}