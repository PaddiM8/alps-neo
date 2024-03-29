import * as refresh from "./refresh";
import * as dialog from "./components/dialog";
import * as mailbox from "./components/mailboxList";

function isLoginRedirect(response) {
    return response.redirected && response.url.split("?")[0].endsWith("/login");
}

async function promptLogin() {
    const overlay = document.createElement("iframe");
    overlay.style.position = "absolute";
    overlay.style.top = "0";
    overlay.style.left = "0";
    overlay.style.width = "100%";
    overlay.style.height = "100%";
    overlay.src = "/login";
    document.body.appendChild(overlay);

    return new Promise((resolve, reject) => {
        overlay.onload = async e => {
            if (!overlay.contentWindow.location.pathname.startsWith("/login")) {
                document.body.removeChild(overlay);
                await refresh.all();
                resolve();
            }
        };
    });
}

export async function get(url, cache = true) {
    const options = {};
    if (!cache) {
        options.cache = "no-store";
    }

    let response = await fetch(url, options);

    if (isLoginRedirect(response)) {
        await promptLogin();
        response = get(url);
    }

    return response;
}

export async function post(url, formData) {
    let response = await fetch(url, {
        method: "POST",
        credentials: "same-origin",
        body: formData,
    });

    if (isLoginRedirect(response)) {
        await promptLogin();
        response = post(url, formData);
    }

    return response;
}

export async function getPreviousAttachments(mailbox, mailId, textPart) {
    const result = await get(`/message/${encodeURIComponent(mailbox)}/${mailId}/forward?part=${textPart}`);
    const lines = (await result.text()).split("\n");
    const attachments = [];
    for (const line of lines) {
        if (!line.trim()) {
            continue;
        }

        const trimmedLine = line.trim();
        if (attachments.length == 0 ||
            Object.keys(attachments[attachments.length - 1]).length == 2) {
            attachments.push({
                partString: trimmedLine
            });
        } else {
            attachments[attachments.length - 1]["name"] = trimmedLine;
        }
    }

    return attachments;
}

async function generateMessageId() {
    const result = await get("/compose");
    if (!result.ok) {
        return null;
    }

    const text = (await result.text()).trim();

    return "<" + text.slice(4, -4) + ">";
}

export async function sendMail(data) {
    const formData = new FormData();
    formData.append("from", data.from);
    formData.append("to", data.to);
    formData.append("subject", data.subject);
    formData.append("text", data.text);
    formData.append("html", data.html);
    formData.append("attachment-uuids", data.attachmentUuids.join(","));
    formData.append("content_type", "text/html");

    for (const prevAttachment of data.prevAttachments ?? []) {
        formData.append("prev_attachments", prevAttachment);
    }

    if (data.saveAsDraft) {
        formData.append("save_as_draft", 1);
    }

    const messageId = await generateMessageId();
    if (!messageId) {
        return false;
    }

    formData.append("message_id", messageId);

    let url = "/compose";
    if (data.inReplyTo) {
        url = `/message/${data.inReplyTo}/reply`;
    } else if (data.toForward) {
        url = `/message/${data.toForward}/forward`;
    }

    const response = await post(url, formData);

    // Seems to redirect on success only. Checking status code
    // is not reliable, since it returns 200 even when when errors
    // happen.
    return response.redirected && response.url.endsWith("/mailbox/INBOX") ||
        data.saveAsDraft && response.url.includes("/message/Drafts/");
}

export async function removeMail(uids, mailbox) {
    const confirmation = await dialog.showYesNo(
        "Delete Mail",
        "Are you sure you want to delete this mail?",
        true
    );

    if (confirmation != "yes") {
        return false;
    }

    if (!Array.isArray(uids)) {
        uids = [uids];
    }

    const formData = new FormData();
    for (const uid of uids) {
        formData.append("uids", uid);
    }

    const response = await post(`/message/${encodeURIComponent(mailbox)}/delete`, formData);

    return response.status == 200;
}

export async function markEmailIsRead(uids, mailbox, read) {
    const formData = new FormData();
    for (const uid of uids) {
        formData.append("uids", uid);
    }

    formData.append("action", read ? "add" : "remove");
    formData.append("flags", "\\Seen");

    await post(`/message/${encodeURIComponent(mailbox)}/flag`, formData);
}

export async function createMailbox(name) {
    const formData = new FormData();
    formData.append("name", name);

    const response = await post("/new-mailbox", formData);

    return response.status == 200;
}

export async function moveToMailbox(uids, name) {
    const formData = new FormData();
    for (const uid of uids) {
        formData.append("uids", uid);
    }

    formData.append("to", name == "Inbox" ? "INBOX" : name);

    const url = `/message/${encodeURIComponent(mailbox.getName(mailbox.getSelected()))}/move`;
    const response = await post(url, formData);

    return response.status == 200;
}

export async function getSettings() {
    const response = await get("/user-settings", cache = false);
    const json = await response.text();

    return response.status == 200 && json
        ? JSON.parse(json)
        : {};
}

export async function setSettings(obj) {
    const formData = new FormData();
    formData.append("json", JSON.stringify(obj));

    const response = await post(`/user-settings`, formData);

    return response.status == 200;
}
