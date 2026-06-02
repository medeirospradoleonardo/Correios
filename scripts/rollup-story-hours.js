const workItemId = process.env.WORK_ITEM_ID;
const orgUrl = process.env.AZDO_ORG_URL;
const project = process.env.AZDO_PROJECT;
const token = process.env.SYSTEM_ACCESSTOKEN;

if (!workItemId) {
  throw new Error("WORK_ITEM_ID not informed.");
}

if (!token) {
  throw new Error("SYSTEM_ACCESSTOKEN not informed.");
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

async function findParentStory(workItem) {
  const parentRelation = workItem.relations?.find(
    relation =>
      relation.rel === "System.LinkTypes.Hierarchy-Reverse"
  );

  if (!parentRelation) {
    return null;
  }

  return Number(parentRelation.url.split("/").pop());
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
        [System.Links.LinkType] = 'System.LinkTypes.Hierarchy-Forward'
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
      ?.filter(relation => relation.target)
      .map(relation => relation.target.id) || []
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

async function updateStory(
  storyId,
  totalOriginal,
  totalRemaining
) {
  const patch = [
    {
      op: "add",
      path: "/fields/Custom.TotalOriginalEstimate",
      value: totalOriginal
    },
    {
      op: "add",
      path: "/fields/Custom.TotalRemainingWork",
      value: totalRemaining
    }
  ];

  const response = await fetch(
    `${apiBase}/wit/workitems/${storyId}?api-version=7.1`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json-patch+json"
      },
      body: JSON.stringify(patch)
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed updating Story (${response.status}): ${errorText}`
    );
  }
}

async function main() {
  console.log(`Processing Work Item ${workItemId}`);

  const workItem = await getWorkItem(workItemId);

  const workItemType =
    workItem.fields["System.WorkItemType"];

  let storyId;

  if (
    workItemType === "User Story" ||
    workItemType === "Product Backlog Item"
  ) {
    storyId = workItem.id;
  } else {
    storyId = await findParentStory(workItem);
  }

  if (!storyId) {
    console.log("No parent story found.");
    return;
  }

  console.log(`Story ID: ${storyId}`);

  const childrenIds = await getChildrenIds(storyId);

  console.log(
    `Found ${childrenIds.length} child work items`
  );

  const children = await getWorkItems(childrenIds);

  let totalOriginal = 0;
  let totalRemaining = 0;

  for (const child of children) {
    totalOriginal +=
      child.fields[
      "Microsoft.VSTS.Scheduling.OriginalEstimate"
      ] || 0;

    totalRemaining +=
      child.fields[
      "Microsoft.VSTS.Scheduling.RemainingWork"
      ] || 0;
  }

  console.log(`Total Original: ${totalOriginal}`);
  console.log(`Total Remaining: ${totalRemaining}`);

  await updateStory(
    storyId,
    totalOriginal,
    totalRemaining
  );

  console.log("Story updated successfully.");
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});