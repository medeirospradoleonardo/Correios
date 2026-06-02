const payload = JSON.parse(
  process.env.WEBHOOK_PAYLOAD || "{}"
);

console.log(
  "Received payload:",
  JSON.stringify(payload, null, 2)
);

const workItemId =
  payload.resource?.workItemId ||
  payload.resource?.id;

const orgUrl = process.env.AZDO_ORG_URL;
const project = process.env.AZDO_PROJECT;
const token = process.env.SYSTEM_ACCESSTOKEN;

if (!workItemId) {
  throw new Error(
    "Unable to determine Work Item Id."
  );
}

if (!token) {
  throw new Error(
    "SYSTEM_ACCESSTOKEN not informed."
  );
}

const apiBase = `${orgUrl}${project}/_apis`;

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const errorText = await response.text();

    throw new Error(
      `Request failed (${response.status}): ${errorText}`
    );
  }

  return response.json();
}

async function getWorkItem(id) {
  return request(
    `${apiBase}/wit/workitems/${id}?$expand=relations&api-version=7.1`
  );
}

async function wait(ms) {
  return new Promise(resolve =>
    setTimeout(resolve, ms)
  );
}

async function findParentStoryWithRetry(
  workItemId
) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const workItem =
      await getWorkItem(workItemId);

    const parentRelation =
      workItem.relations?.find(
        relation =>
          relation.rel ===
          "System.LinkTypes.Hierarchy-Reverse"
      );

    if (parentRelation) {
      return Number(
        parentRelation.url
          .split("/")
          .pop()
      );
    }

    console.log(
      `Parent not found. Retry ${attempt}/5`
    );

    await wait(3000);
  }

  return null;
}

async function getChildrenIds(parentId) {
  const wiql = {
    query: `
      SELECT [System.Id]
      FROM WorkItemLinks
      WHERE
      (
        [Source].[System.Id] = ${parentId}
      )
      AND
      (
        [System.Links.LinkType] =
        'System.LinkTypes.Hierarchy-Forward'
      )
      MODE (MustContain)
    `
  };

  const result = await request(
    `${apiBase}/wit/wiql?api-version=7.1`,
    {
      method: "POST",
      body: JSON.stringify(wiql)
    }
  );

  return (
    result.workItemRelations
      ?.filter(r => r.target)
      .map(r => r.target.id) || []
  );
}

async function getWorkItems(ids) {
  if (!ids.length) {
    return [];
  }

  const result = await request(
    `${apiBase}/wit/workitems?ids=${ids.join(",")}&api-version=7.1`
  );

  return result.value;
}

function isRollupUpdate(payload) {
  const changedFields =
    payload.resource?.fields || {};

  const keys =
    Object.keys(changedFields);

  return (
    keys.length > 0 &&
    keys.every(
      key =>
        key ===
        "Microsoft.VSTS.Scheduling.OriginalEstimate" ||
        key ===
        "Microsoft.VSTS.Scheduling.RemainingWork"
    )
  );
}

async function updateStory(
  storyId,
  totalOriginal,
  totalRemaining
) {
  const story =
    await getWorkItem(storyId);

  const currentOriginal =
    story.fields[
    "Microsoft.VSTS.Scheduling.OriginalEstimate"
    ] || 0;

  const currentRemaining =
    story.fields[
    "Microsoft.VSTS.Scheduling.RemainingWork"
    ] || 0;

  console.log(
    `Current Original: ${currentOriginal}`
  );

  console.log(
    `Current Remaining: ${currentRemaining}`
  );

  if (
    currentOriginal === totalOriginal &&
    currentRemaining === totalRemaining
  ) {
    console.log(
      "Story already synchronized."
    );
    return;
  }

  const patch = [
    {
      op: "add",
      path:
        "/fields/Microsoft.VSTS.Scheduling.OriginalEstimate",
      value: totalOriginal
    },
    {
      op: "add",
      path:
        "/fields/Microsoft.VSTS.Scheduling.RemainingWork",
      value: totalRemaining
    }
  ];

  const response = await fetch(
    `${apiBase}/wit/workitems/${storyId}?api-version=7.1`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type":
          "application/json-patch+json"
      },
      body: JSON.stringify(patch)
    }
  );

  if (!response.ok) {
    const errorText =
      await response.text();

    throw new Error(
      `Failed updating Story (${response.status}): ${errorText}`
    );
  }
}

function isRollupUpdate(payload) {
  const fields =
    payload.resource?.fields || {};

  const changedFields =
    Object.keys(fields);

  return (
    changedFields.length > 0 &&
    changedFields.every(field =>
      [
        "Microsoft.VSTS.Scheduling.OriginalEstimate",
        "Microsoft.VSTS.Scheduling.RemainingWork"
      ].includes(field)
    )
  );
}

async function main() {
  console.log(
    `Processing Work Item ${workItemId}`
  );

  const workItem =
    await getWorkItem(workItemId);

  const type =
    workItem.fields[
    "System.WorkItemType"
    ];

  console.log(`Type: ${type}`);

  let storyId;

  if (type === "Task") {
    console.log(
      "Task event detected."
    );

    storyId =
      await findParentStoryWithRetry(
        workItem.id
      );
  }
  else if (
    type === "User Story" ||
    type === "Product Backlog Item"
  ) {
    if (isRollupUpdate(payload)) {
      console.log(
        "Rollup update detected. Ignoring."
      );
      return;
    }

    const relations =
      payload.resource?.relations || {};

    const hierarchyChanged =
      relations.added?.some(
        relation =>
          relation.rel ===
          "System.LinkTypes.Hierarchy-Forward"
      ) ||
      relations.removed?.some(
        relation =>
          relation.rel ===
          "System.LinkTypes.Hierarchy-Forward"
      );

    if (!hierarchyChanged) {
      console.log(
        "Story updated but no child relationship changed."
      );
      return;
    }

    console.log(
      "Story child relationship changed."
    );

    storyId = workItem.id;
  }
  else {
    console.log(
      `Unsupported work item type: ${type}`
    );
    return;
  }

  if (!storyId) {
    console.log(
      "No parent story found."
    );
    return;
  }

  console.log(`Story ID: ${storyId}`);

  const childrenIds =
    await getChildrenIds(storyId);

  console.log(
    "Children IDs:",
    JSON.stringify(childrenIds)
  );

  const children = (
    await getWorkItems(childrenIds)
  ).filter(child => {
    const childType =
      child.fields[
      "System.WorkItemType"
      ];

    return (
      childType !== "User Story" &&
      childType !==
      "Product Backlog Item"
    );
  });

  console.log(
    `Children found: ${children.length}`
  );

  let totalOriginal = 0;
  let totalRemaining = 0;

  for (const child of children) {
    const original =
      child.fields[
      "Microsoft.VSTS.Scheduling.OriginalEstimate"
      ] || 0;

    const remaining =
      child.fields[
      "Microsoft.VSTS.Scheduling.RemainingWork"
      ] || 0;

    console.log(
      `#${child.id} | ${child.fields["System.WorkItemType"]} | Original=${original} | Remaining=${remaining}`
    );

    totalOriginal += original;
    totalRemaining += remaining;
  }

  console.log(
    `Calculated Original: ${totalOriginal}`
  );

  console.log(
    `Calculated Remaining: ${totalRemaining}`
  );

  await updateStory(
    storyId,
    totalOriginal,
    totalRemaining
  );

  console.log(
    "Story updated successfully."
  );
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});