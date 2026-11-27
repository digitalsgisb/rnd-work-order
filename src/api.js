async function request(path, options = {}) {
  const response = await fetch("/api" + path, {
    credentials: "same-origin",
    cache: "no-store",
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-RND-Request": "1",
      ...options.headers
    }
  });

  const data = await response.json();

  if (!response.ok) {
    const error = new Error(
      data.error || "Request failed"
    );

    error.status = response.status;
    throw error;
  }

  return data;
}

function mapUser(user) {
  return {
    id: String(user.id),
    name: user.full_name,
    username: user.username,
    employeeId: user.employee_id,
    department: user.department,
    departmentId: user.department_id,
    role: user.role
  };
}

export async function signIn(username, password) {
  const result = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password })
  });

  return mapUser(result.user);
}

export async function getSession() {
  try {
    const result = await request("/auth/me");
    return mapUser(result.user);
  } catch (error) {
    if (error.status === 401) return null;
    throw error;
  }
}

export async function signOut() {
  return request("/auth/logout", {
    method: "POST",
    body: "{}"
  });
}

export async function getDepartments() {
  return request("/departments");
}

export async function getOrders() {
  const records = await request("/work-orders");

  return records.map(row => {
    const a = row.request_data || {};
    const b = row.rd_data || {};

    return {
      id: String(row.id),
      workOrderId: row.work_order_id,
      version: row.version,
      ref: row.reference_no || "",
      requesterId: String(row.requester_id),
      issuedBy: row.requester || "",
      department: row.department || "",
      departmentId: row.department_id,
      section: row.section || "",
      title: row.title || "",
      description: row.description || "",
      status: row.status,
      team: a.team || "",
      teamOther: a.teamOther || "",
      types: a.types || [],
      typeOther: a.typeOther || "",
      reasons: a.reasons || [],
      reasonOther: a.reasonOther || "",
      sketch: a.sketch || "No",
      priority: a.priority || "Normal",
      due: row.requested_completion_date || "",
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      submittedAt: row.submitted_at || "",
      approvedAt: row.approved_at || "",
      receivedAt: row.received_at || "",
      method: b.method || "",
      external: b.external || "",
      evaluation: b.evaluation || "",
      pic: row.pic_name || "",
      assignedPic: row.assigned_pic,
      start: b.start || "",
      estimate: row.estimated_completion_date || "",
      startedAt: row.actual_start_date || "",
      actual: row.actual_completion_date || "",
      outcome: b.outcome || "",
      completionRemarks: b.completionRemarks || "",
      verificationRequired: !!b.verificationRequired,
      completedBy: b.completedBy || "",
      completedAt: b.completedAt || "",
      verifiedBy: b.verifiedBy || "",
      verifiedAt: b.verifiedAt || "",
      ackBy: b.ackBy || "",
      ackAt: b.ackAt || "",
      photos: [],
      documents: [],
      history: []
    };
  });
}

export async function getOrderDetails(order) {
  const route = "/work-orders/" + order.id;

  const [records, photoRecords, attachmentRecords] =
    await Promise.all([
      request(route + "/history"),
      request(route + "/photos"),
      request(route + "/attachments")
    ]);

  const history = records.map(h => ({
    id: String(h.id),
    action: h.action,
    by: h.changed_by_name || "Unknown",
    byId: String(h.changed_by || ""),
    role: h.account_role,
    at: h.created_at,
    details: h.remarks || "",

    photoNames: [...new Set(
      (h.changes || []).flatMap(c => {
        const ids = [c.photo_id];

        if (/photo/i.test(c.field || "")) {
          if (
            typeof c.updated === "string" ||
            typeof c.updated === "number"
          ) ids.push(c.updated);
        }

        return ids
          .filter(id => id != null)
          .map(id => photoRecords.find(
            p => String(p.id) === String(id)
          )?.file_name)
          .filter(Boolean);
      })
    )],

    changes: (h.changes || []).map(c =>
      c.field ? c : {
        field: "Photo version",
        previous: c.previous_photo_id,
        updated: c.photo_id
      }
    )
  }));

  const photos = [];

  for (const p of photoRecords.filter(p => p.is_current)) {
    const response = await fetch(
      "/api" + route + "/photos/" + p.id + "/content",
      {
        credentials: "same-origin",
        cache: "no-store"
      }
    );

    if (!response.ok) {
      throw new Error("Unable to load photo " + p.id);
    }

    const blob = await response.blob();

    photos.push({
      id: String(p.id),
      serverId: String(p.id),
      name: p.file_name,
      kind: p.photo_type,
      description: p.description || "",
      blob,
      by: history.find(
        h => h.byId === String(p.uploaded_by)
      )?.by || "Employee",
      at: p.uploaded_at
    });
  }

  function localTime(value) {
    if (!value) return "";

    const date = new Date(value);

    if (isNaN(date.getTime())) return "";

    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Kuala_Lumpur",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23"
      }).formatToParts(date).map(
        p => [p.type, p.value]
      )
    );

    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
  }

  return {
    ...order,
    start: localTime(order.start),
    estimate: localTime(order.estimate),
    actual: localTime(order.actual),
    approvedBy: order.approvedAt
      ? history.findLast(h => h.action === "Approved")?.by || ""
      : "",
    receivedBy: order.receivedAt
      ? history.findLast(h => h.action === "Received by R&D")?.by || ""
      : "",
    history,
    photos,

    documents: attachmentRecords.map(d => ({
      id: String(d.id),
      serverId: String(d.id),
      name: d.file_name,
      kind: "document",
      size: Number(d.file_size || 0),
      mimeType: d.mime_type,
      by: d.uploaded_by_name || "Employee",
      at: d.uploaded_at,
      url: "/api" + route +
        "/attachments/" + d.id + "/content"
    })),

    photoVersions: photoRecords.filter(p => !p.is_current)
      .map(p => ({
        id: p.id,
        name: p.file_name,
        kind: p.photo_type,
        at: p.uploaded_at,
        url: "/api" + route + "/photos/" + p.id + "/content"
      }))
  };
}

async function loadOrder(id) {
  const orders = await getOrders();

  const order = orders.find(
    o => String(o.id) === String(id)
  );

  if (!order) {
    throw new Error("Work order not found");
  }

  return getOrderDetails(order);
}

export async function createDraft() {
  const result = await request("/work-orders", {
    method: "POST",
    body: JSON.stringify({
      title: "Untitled draft",
      reference_no: "",
      description: "",
      section: ""
    })
  });

  try {
    return await loadOrder(result.work_order.id);
  } catch (error) {
    throw new Error(
      "Draft created. Refresh the dashboard to open it."
    );
  }
}

function requestFields(order) {
  return {
    title: order.title || "",
    reference_no: order.ref || "",
    section: order.section || "",
    description: order.description || "",
    due: order.due || "",
    team: order.team || "",
    teamOther: order.teamOther || "",
    types: order.types || [],
    typeOther: order.typeOther || "",
    reasons: order.reasons || [],
    reasonOther: order.reasonOther || "",
    sketch: order.sketch || "No",
    priority: order.priority || "Normal"
  };
}

async function uploadPhoto(id, photo, version, note) {
  const form = new FormData();

  form.append("photo", photo.blob, photo.name);
  if (!["before", "inspection", "after"].includes(photo.kind)) {
    throw new Error("Invalid photo type");
  }

  form.append("photo_type", photo.kind);
  form.append("description", photo.description || "");
  form.append("version", String(version));
  form.append("note", note || "");

  if (photo.replacesId) {
    form.append(
      "replaces_photo_id",
      String(photo.replacesId)
    );
  }

  const response = await fetch(
    "/api/work-orders/" + id + "/photos",
    {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "X-RND-Request": "1"
      },
      body: form
    }
  );

  const result = await response.json();

  if (!response.ok) {
    const error = new Error(
      result.error || "Photo upload failed"
    );

    error.status = response.status;
    throw error;
  }

  return result;
}

export async function saveRequesterOrder(
  base, draft, action, note = ""
) {
  const route = "/work-orders/" + base.id;

  let version = base.version;
  let wrote = false;

  const fields = requestFields(draft);
  const previous = requestFields(base);

  const pendingPhotos = draft.photos.filter(
    p => !p.serverId && p.kind === "before"
  );

  const submitted = ![
    "draft", "correction"
  ].includes(base.status);

  const pendingDocuments = (draft.documents || [])
    .filter(d => !d.serverId);

  if (submitted && pendingDocuments.length) {
    throw new Error(
      "Documents can only be added to draft or returned requests."
    );
  }

  if ((draft.documents || []).length > 10) {
    throw new Error(
      "Maximum 10 supporting documents per work order."
    );
  }

  const material = Object.keys(fields).some(
    key => key !== "reference_no" &&
      JSON.stringify(fields[key]) !==
      JSON.stringify(previous[key])
  );

  if (
    submitted &&
    (material || pendingPhotos.length) &&
    !note.trim()
  ) {
    throw new Error("Please provide a revision reason.");
  }

  if (action && action !== "submit") {
    throw new Error("This action is not connected yet.");
  }

  try {
    // Save request fields
    if (
      JSON.stringify(fields) !==
      JSON.stringify(previous)
    ) {
      const result = await request(
        route + "/request",
        {
          method: "PATCH",
          body: JSON.stringify({
            ...fields,
            version,
            note
          })
        }
      );

      version = result.work_order.version;
      wrote = true;
    }

    // Upload new and replacement photos
    for (const photo of pendingPhotos) {
      const result = await uploadPhoto(
        base.id, photo, version, note
      );

      version = result.version;
      wrote = true;
    }

    // Upload supporting documents
    for (const file of pendingDocuments) {
      const result = await uploadAttachment(
        base.id, file, version
      );

      version = result.version;
      wrote = true;
    }

    // Submit only after details, photos and documents are saved
    if (action === "submit") {
      const result = await request(
        route + "/actions",
        {
          method: "POST",
          body: JSON.stringify({
            action: "submit",
            version
          })
        }
      );

      version = result.work_order.version;
      wrote = true;
    }

    return await loadOrder(base.id);

  } catch (error) {
    if (wrote || !error.status || error.status === 409) {
      try {
        error.latest = await loadOrder(base.id);
        error.message +=
          " Server records reloaded. Check your changes before continuing.";
      } catch {
        error.reloadRequired = true;
        error.message +=
          " Close this popup and refresh before retrying.";
      }
    }

    throw error;
  }
}


export async function performWorkflowAction(
  order, action, note = ""
) {
  if (![
      "approve", "return", "reject", "receive",
      "verify", "rectify", "close", "reopen", "unable"
    ].includes(action)) {
    throw new Error("Action is not supported yet.");
  }

  if (
    ["return", "reject", "rectify", "reopen", "unable"].includes(action) &&
    !note.trim()
  ) {
    throw new Error("Please provide a reason.");
  }

  let wrote = false;

  try {
    await request(
      "/work-orders/" + order.id + "/actions",
      {
        method: "POST",
        body: JSON.stringify({
          action,
          note,
          version: order.version
        })
      }
    );

    wrote = true;

    const orders = await getOrders();

    const updated = orders.find(
      o => String(o.id) === String(order.id)
    );

    if (!updated) return null;

    return await getOrderDetails(updated);

  } catch (error) {
    if (wrote || !error.status || error.status === 409) {
      try {
        error.latest = await loadOrder(order.id);
        error.message += " Latest server records loaded.";
      } catch {
        error.reloadRequired = true;
      }
    }

    throw error;
  }
}


export async function getPlanningPics() {
  return request("/work-orders/planning/pics");
}

export async function savePlanningOrder(
  base, draft, action
) {
  const route = "/work-orders/" + base.id;
  let wrote = false;

  function malaysiaTime(value) {
    if (
      typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)
    ) {
      throw new Error("Enter a valid planning date and time.");
    }

    return value + ":00+08:00";
  }

  try {
    if (!action) {
      const data = {
        version: base.version,
        method: draft.method,
        external: draft.external || "",
        evaluation: draft.evaluation || "",
        start: malaysiaTime(draft.start),
        estimate: malaysiaTime(draft.estimate)
      };

      if (
        draft.assignedPic &&
        draft.assignedPic !== base.assignedPic
      ) {
        data.assigned_pic = String(draft.assignedPic);
      }

      await request(route + "/planning", {
        method: "PATCH",
        body: JSON.stringify(data)
      });

      wrote = true;

    } else {
      if (!["plan", "start"].includes(action)) {
        throw new Error("Invalid planning action");
      }

      await request(route + "/actions", {
        method: "POST",
        body: JSON.stringify({
          action,
          version: base.version
        })
      });

      wrote = true;
    }

    return await loadOrder(base.id);

  } catch(error) {
    if (wrote || error.status === 409) {
      try {
        error.latest = await loadOrder(base.id);
      } catch {
        error.reloadRequired = true;
      }
    }

    throw error;
  }
}


export async function saveCompletionOrder(
  base, draft, action
) {
  const route = "/work-orders/" + base.id;

  let version = Number(base.version);
  let attempted = false;

  const pendingPhotos = draft.photos.filter(
    p => !p.serverId &&
      ["inspection", "after"].includes(p.kind)
  );

  const fields = [
    "outcome",
    "actual",
    "completionRemarks",
    "verificationRequired"
  ];

  const changed = fields.some(
    key => draft[key] !== base[key]
  );

  if (action && action !== "finish") {
    throw new Error("Invalid completion action");
  }

  if (!action) {
    for (const photo of pendingPhotos) {
      if (!(photo.description || "").trim()) {
        throw new Error(
          "Please provide a description for each R&D photo."
        );
      }
    }
  }

  function malaysiaTime(value) {
    if (
      typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)
    ) {
      throw new Error(
        "Enter a valid actual completion date and time."
      );
    }

    return value + ":00+08:00";
  }

  try {
    if (action === "finish") {
      attempted = true;

      await request(route + "/actions", {
        method: "POST",
        body: JSON.stringify({
          action: "finish",
          version
        })
      });

    } else {
      if (changed) {
        if (!draft.outcome) {
          throw new Error("Select the work completion outcome.");
        }

        if (!(draft.completionRemarks || "").trim()) {
          throw new Error("Enter the completion remarks.");
        }

        const payload = {
          version,
          outcome: draft.outcome,
          actual: malaysiaTime(draft.actual),
          completionRemarks: draft.completionRemarks,
          verificationRequired: !!draft.verificationRequired
        };

        attempted = true;

        await request(route + "/completion", {
          method: "PATCH",
          body: JSON.stringify(payload)
        });

        version += 1;
      }

      for (const photo of pendingPhotos) {
        attempted = true;

        await uploadPhoto(
          base.id,
          photo,
          version,
          ""
        );

        version += 1;
      }
    }

    return await loadOrder(base.id);

  } catch(error) {
    if (attempted || error.status === 409) {
      try {
        error.latest = await loadOrder(base.id);
      } catch {
        error.reloadRequired = true;
      }
    }

    throw error;
  }
}


async function uploadAttachment(id, file, version) {
  const form = new FormData();

  form.append("attachment", file.blob, file.name);
  form.append("version", String(version));

  const response = await fetch(
    "/api/work-orders/" + id + "/attachments",
    {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "X-RND-Request": "1"
      },
      body: form
    }
  );

  const result = await response.json();

  if (!response.ok) {
    const error = new Error(
      result.error || "Document upload failed"
    );

    error.status = response.status;
    throw error;
  }

  return result;
}


export async function getNotifications() {
  return request("/notifications");
}

export async function getUnreadCount() {
  return request("/notifications/unread-count");
}

export async function markNotificationRead(id) {
  return request(
    "/notifications/" + encodeURIComponent(id) + "/read",
    {
      method:"PATCH",
      body:JSON.stringify({})
    }
  );
}

export async function markAllNotificationsRead() {
  return request("/notifications/read-all",{
    method:"PATCH",
    body:JSON.stringify({})
  });
}
