const firebaseConfig = {
  apiKey: "AIzaSyAKdS2q1eYNIHnsPyWD3J62F6_J61-CT1Y",
  authDomain: "ae-funsite.firebaseapp.com",
  projectId: "ae-funsite",
  storageBucket: "ae-funsite.firebasestorage.app",
  messagingSenderId: "941443760137",
  appId: "1:941443760137:web:723b62cafb82f14c8278d8",
  measurementId: "G-Y1L6XN0PJC"
};


firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

const ROLE_LABELS = { general: "一般", fan: "ファン", aureole: "アレオル", admin: "管理者" };
const ROLE_BADGE_CLASSES = {
    general: "bg-yellow-400 text-sky-900",
    fan: "bg-pink-400 text-white",
    aureole: "bg-violet-500 text-white",
    admin: "bg-red-500 text-white"
};
const ROLE_PRIORITY = { general: 0, fan: 1, aureole: 2, admin: 3 };
const SECRET_KEYWORDS = { home: "輝", about: "空", timeline: "い", events: "ね", terms: "い" };
const YOUTUBE_CHANNEL_URL = "https://www.youtube.com/@-aureoleetoile-6660";
const YOUTUBE_API_KEY = "";
const YOUTUBE_CHANNEL_ID = "";

let cachedPosts = [];
let cachedAnnouncements = [];
let cachedEvents = [];
let cachedXPosts = [];
let currentRole = "general";
let currentProfile = null;
let pendingAuthMode = null;
let settingsUnlocked = false;
let roleUnsubscribe = null;
let profileUnsubscribe = null;
let progressUnsubscribe = null;
let iconCropState = { dataUrl: "", zoom: 1, x: 0, y: 0 };
let userProgress = { home: false, about: false, timeline: false, events: false, terms: false };
let runnerState = null;
const openReplyThreads = new Set();

function escapeHtml(value = "") {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function normalizeInviteCode(value = "") {
    return value.trim().replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 12);
}

function formatInviteCode(value = "") {
    const raw = normalizeInviteCode(value);
    return [raw.slice(0, 4), raw.slice(4, 8), raw.slice(8, 12)].filter(Boolean).join("-");
}

function readCodeParts(prefix) {
    return normalizeInviteCode([1, 2, 3].map(index => document.getElementById(`${prefix}-${index}`)?.value || "").join(""));
}

function makeId(prefix = "id") {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function writeCodeParts(prefix, code = "") {
    const raw = normalizeInviteCode(code);
    [1, 2, 3].forEach(index => {
        const input = document.getElementById(`${prefix}-${index}`);
        if (input) input.value = raw.slice((index - 1) * 4, index * 4);
    });
}

function setupCodePartInputs(selector) {
    document.querySelectorAll(selector).forEach((input, index, inputs) => {
        input.addEventListener("input", () => {
            input.value = normalizeInviteCode(input.value);
            if (input.value.length === 4 && inputs[index + 1]) inputs[index + 1].focus();
        });
        input.addEventListener("keydown", event => {
            if (event.key === "Backspace" && !input.value && inputs[index - 1]) inputs[index - 1].focus();
        });
    });
}

async function sha256Hex(value) {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function validatePasswordStrength(password) {
    if (password.length < 8) return "パスワードは8文字以上にしてください。";
    if (!/[A-Za-z]/.test(password)) return "パスワードには英字を1文字以上含めてください。";
    if (!/[0-9]/.test(password)) return "パスワードには数字を1文字以上含めてください。";
    if (!/[^A-Za-z0-9]/.test(password)) return "パスワードには記号を1文字以上含めてください。";
    return "";
}

async function hashPassword(password) {
    if (!auth.currentUser) throw new Error("ログインが必要です。");
    return sha256Hex(`${auth.currentUser.uid}:${auth.currentUser.email || "NO_EMAIL"}:${password}`);
}

async function hashPasswordLegacy(password, memberId = "") {
    if (!auth.currentUser) throw new Error("ログインが必要です。");
    return sha256Hex(`${auth.currentUser.uid}:${memberId || "NO_MEMBER_ID"}:${password}`);
}

async function passwordMatchesStored(password) {
    const currentHash = await hashPassword(password);
    if (currentHash === currentProfile?.passwordHash) return { ok: true, needsMigration: false };

    const candidates = [
        currentProfile?.memberId || "",
        currentProfile?.grantedByInvite || "",
        ""
    ];
    for (const memberId of [...new Set(candidates)]) {
        if (await hashPasswordLegacy(password, memberId) === currentProfile?.passwordHash) {
            return { ok: true, needsMigration: true, migratedHash: currentHash };
        }
    }
    return { ok: false, needsMigration: false };
}

function getRoleBadge(role = "general") {
    const safeRole = ROLE_LABELS[role] ? role : "general";
    return `<span class="${ROLE_BADGE_CLASSES[safeRole]} text-[10px] px-1.5 py-0.5 rounded-full font-bold ml-1">${ROLE_LABELS[safeRole]}</span>`;
}

function roleAtLeast(role) {
    return ROLE_PRIORITY[currentRole] >= ROLE_PRIORITY[role];
}

function canDeletePosts() {
    return roleAtLeast("fan");
}

function canUseOpsPortal() {
    return roleAtLeast("aureole");
}

function hasServiceAccount() {
    return !!auth.currentUser
        && !!currentProfile
        && currentProfile.googleUid === auth.currentUser.uid
        && currentProfile.email === auth.currentUser.email;
}

function getDisplayName() {
    return currentProfile?.displayName || auth.currentUser?.displayName || "ユーザー";
}

function validateYouTubeUrl(value = "") {
    let url;
    try {
        url = new URL(value.trim());
    } catch {
        return { ok: false, message: "URLの形式が正しくありません。" };
    }
    if (url.protocol !== "https:") return { ok: false, message: "YouTube URLは https のみ添付できます。" };
    const host = url.hostname.toLowerCase();
    const allowedHosts = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"]);
    if (!allowedHosts.has(host)) return { ok: false, message: "添付できるURLはYouTubeの正規ドメインのみです。" };
    if (host === "youtu.be" && url.pathname.split("/").filter(Boolean).length !== 1) return { ok: false, message: "短縮URLの形式が正しくありません。" };
    if (host !== "youtu.be" && !["/watch", "/shorts", "/live"].some(path => url.pathname.startsWith(path))) return { ok: false, message: "YouTubeの動画・Shorts・Live URLのみ添付できます。" };
    return { ok: true, normalized: url.toString() };
}

function requireGoogleAuth() {
    if (auth.currentUser) return true;
    alert("Google認証が必要です。ログインから進んでください。");
    openLoginChoice();
    return false;
}

function requireServiceAccount() {
    if (hasServiceAccount()) return true;
    if (!auth.currentUser) {
        alert("サービスを利用するにはログインが必要です。");
        openLoginChoice();
        return false;
    }
    alert("サービスアカウント登録が完了していません。新規登録へ進んでください。");
    switchWindow("register");
    return false;
}

auth.onAuthStateChanged(user => {
    const authStatusDiv = document.getElementById("auth-status");
    if (roleUnsubscribe) roleUnsubscribe();
    if (profileUnsubscribe) profileUnsubscribe();
    if (progressUnsubscribe) progressUnsubscribe();
    currentRole = "general";
    currentProfile = null;
    settingsUnlocked = false;

    if (user) {
        authStatusDiv.innerHTML = `
            <img src="${escapeHtml(user.photoURL || "")}" class="w-6 h-6 rounded-full border border-white" alt="ユーザーアイコン">
            <span class="font-bold text-white hidden md:inline">照合中...</span>
            <span id="role-badge">${getRoleBadge("general")}</span>
            <button onclick="logout()" class="text-[10px] bg-sky-600/50 hover:bg-red-500 px-2 py-0.5 rounded transition-colors ml-2">ログアウト</button>
        `;
        setSidebarAuthButton(true);
        hydrateMemberForms(user);

        roleUnsubscribe = db.collection("userRoles").doc(user.uid).onSnapshot(doc => {
            currentRole = doc.exists && ROLE_LABELS[doc.data().role] ? doc.data().role : "general";
            const badge = document.getElementById("role-badge");
            if (badge) badge.innerHTML = getRoleBadge(currentRole);
            updateRoleAwareUI();
        }, console.error);

        profileUnsubscribe = db.collection("memberProfiles").doc(user.uid).onSnapshot(doc => {
            currentProfile = doc.exists ? doc.data() : null;
            updateProfileUI();
            handlePendingAuthMode();
            updateRoleAwareUI();
            renderTimeline(cachedPosts);
        }, console.error);

        loadUserProgress(user.uid);
    } else {
        authStatusDiv.innerHTML = `
            <button onclick="openLoginChoice()" class="bg-white text-sky-600 font-bold px-3 py-1 rounded-lg text-xs shadow-sm hover:bg-sky-50 transition-colors flex items-center gap-1">
                <i class="fas fa-right-to-bracket text-sky-500"></i>ログイン
            </button>
        `;
        setSidebarAuthButton(false);
        userProgress = { home: false, about: false, timeline: false, events: false, terms: false };
        updateProgressUI();
        updateRoleAwareUI();
        renderSecretButtons();
        renderTimeline(cachedPosts);
    }
});

function openLoginChoice() {
    const modal = document.getElementById("login-choice-modal");
    if (modal) {
        modal.classList.remove("hidden");
        modal.classList.add("flex");
    }
}

function closeLoginChoice() {
    const modal = document.getElementById("login-choice-modal");
    if (modal) {
        modal.classList.add("hidden");
        modal.classList.remove("flex");
    }
}

function beginLoginFlow(mode) {
    pendingAuthMode = mode;
    closeLoginChoice();
    loginWithGoogle(mode);
}

function loginWithGoogle(mode = "login") {
    pendingAuthMode = mode;
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider).then(result => routeAfterGoogleAuth(result.user, mode)).catch(error => {
        alert(`ログインに失敗しました: ${error.message}`);
    });
}

async function routeAfterGoogleAuth(user, mode) {
    if (!user) return;
    pendingAuthMode = null;
    hydrateMemberForms(user);
    const profileDoc = await db.collection("memberProfiles").doc(user.uid).get();
    const profile = profileDoc.exists ? profileDoc.data() : null;
    if (mode === "register") {
        if (profile && profile.googleUid === user.uid && profile.email === user.email) {
            alert("このGoogleアカウントはすでにサービス登録済みです。");
            switchWindow("home");
        } else {
            switchWindow("register");
        }
        return;
    }
    if (profile && profile.googleUid === user.uid && profile.email === user.email) {
        alert("ログインしました。");
        switchWindow("home");
    } else {
        alert("このGoogleアカウントに一致するサービスアカウントがありません。新規登録へ進んでください。");
        switchWindow("register");
    }
}

function handlePendingAuthMode() {
    if (!pendingAuthMode || !auth.currentUser) return;
    const mode = pendingAuthMode;
    pendingAuthMode = null;
    if (mode === "register" || !hasServiceAccount()) switchWindow("register");
}

function logout() {
    if (!confirm("ログアウトしてよろしいですか？")) return;
    auth.signOut().then(() => {
        alert("ログアウトしました。");
        switchWindow("home");
    });
}

function setSidebarAuthButton(isLoggedIn) {
    const button = document.getElementById("sidebar-auth-btn");
    if (!button) return;
    if (isLoggedIn) {
        button.innerHTML = `<i class="fas fa-right-from-bracket text-red-500"></i>ログアウト`;
        button.onclick = logout;
    } else {
        button.innerHTML = `<i class="fas fa-right-to-bracket text-sky-500"></i>ログイン`;
        button.onclick = openLoginChoice;
    }
}

function hydrateMemberForms(user) {
    const emailInput = document.getElementById("member-email");
    const displayInput = document.getElementById("member-display-name");
    if (emailInput) emailInput.value = user.email || "";
    if (displayInput && !displayInput.value) displayInput.value = user.displayName || "";
}

function updateProfileUI() {
    const name = hasServiceAccount() ? getDisplayName() : "登録未完了";
    const icon = currentProfile?.iconDataUrl || auth.currentUser?.photoURL || "";
    const authImg = document.querySelector("#auth-status img");
    const authName = document.querySelector("#auth-status span.font-bold");
    if (authImg) authImg.src = icon;
    if (authName) authName.textContent = `${name} さん`;
    const settingsName = document.getElementById("settings-display-name");
    if (settingsName) settingsName.value = currentProfile?.displayName || "";
    writeCodeParts("settings-member-id", currentProfile?.memberId || "");
    updateMemberIdLock();
}

function updateMemberIdLock() {
    const hasId = !!currentProfile?.memberId;
    document.querySelectorAll(".settings-member-id-part").forEach(input => {
        input.readOnly = hasId;
        input.classList.toggle("cursor-not-allowed", hasId);
        input.classList.toggle("bg-gray-100", hasId);
    });
    const clearButton = document.getElementById("settings-member-id-clear");
    if (clearButton) clearButton.classList.toggle("hidden", !hasId);
}

function clearSettingsMemberId() {
    if (!confirm("会員IDを設定画面から消しますか？権限自体の変更には管理者の確認が必要です。")) return;
    currentProfile = { ...currentProfile, memberId: "" };
    writeCodeParts("settings-member-id", "");
    updateMemberIdLock();
}

function updateRoleAwareUI() {
    const settingsBtn = document.getElementById("settings-nav-btn");
    if (settingsBtn) {
        const active = hasServiceAccount();
        settingsBtn.disabled = !active;
        settingsBtn.className = active
            ? "w-full text-left px-4 py-2.5 rounded-lg font-bold text-sky-700 hover:bg-sky-50 transition-colors flex items-center gap-3"
            : "w-full text-left px-4 py-2.5 rounded-lg font-bold text-gray-400 bg-gray-50 cursor-not-allowed flex items-center gap-3";
    }
    renderOpsIfPresent();
}

function switchWindow(windowId) {
    document.querySelectorAll(".window-content").forEach(win => win.classList.add("hidden"));
    const targetWin = document.getElementById(`window-${windowId}`);
    if (targetWin) targetWin.classList.remove("hidden");
    if (windowId === "settings") {
        const guard = document.getElementById("settings-guard");
        const gate = document.getElementById("settings-password-gate");
        const panel = document.getElementById("settings-panel");
        const loggedIn = hasServiceAccount();
        if (guard) guard.classList.toggle("hidden", loggedIn);
        if (gate) gate.classList.toggle("hidden", !loggedIn || settingsUnlocked);
        if (panel) panel.classList.toggle("hidden", !loggedIn || !settingsUnlocked);
        updateMemberIdLock();
    }
    closeSidebar();
}

async function unlockSettingsPanel() {
    if (!requireServiceAccount()) return;
    const password = document.getElementById("settings-gate-password").value;
    const match = await passwordMatchesStored(password);
    if (!match.ok) {
        alert("パスワードが違います。");
        return;
    }
    if (match.needsMigration) {
        await db.collection("memberProfiles").doc(auth.currentUser.uid).set({
            passwordHash: match.migratedHash,
            passwordHashVersion: 2,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    }
    settingsUnlocked = true;
    document.getElementById("settings-gate-password").value = "";
    switchWindow("settings");
}

function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("画像の読み込みに失敗しました。"));
        reader.readAsDataURL(file);
    });
}

async function handleIconFile(file, anchorId = "member-icon-file") {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("アイコン画像はPNG/JPEG/WebPのみ登録できます。");
    if (file.size > 2 * 1024 * 1024) throw new Error("アイコン画像は2MB以下にしてください。");
    iconCropState = { dataUrl: await fileToDataUrl(file), zoom: 1, x: 0, y: 0 };
    const cropper = document.getElementById("icon-cropper");
    const anchor = document.getElementById(anchorId);
    if (cropper && anchor) {
        const host = anchor.closest("div") || anchor.parentElement;
        host.appendChild(cropper);
        cropper.classList.remove("hidden");
    }
    updateIconPreview();
}

function updateIconPreview() {
    const img = document.getElementById("icon-crop-preview");
    if (!img || !iconCropState.dataUrl) return;
    img.src = iconCropState.dataUrl;
    img.style.width = `${192 * iconCropState.zoom}px`;
    img.style.height = `${192 * iconCropState.zoom}px`;
    img.style.left = `${iconCropState.x}px`;
    img.style.top = `${iconCropState.y}px`;
    img.style.objectFit = "cover";
}

async function getCroppedIconDataUrl() {
    if (!iconCropState.dataUrl) return "";
    const image = new Image();
    image.src = iconCropState.dataUrl;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");
    ctx.beginPath();
    ctx.arc(128, 128, 128, 0, Math.PI * 2);
    ctx.clip();
    const scale = iconCropState.zoom;
    const drawSize = 256 * scale;
    ctx.drawImage(image, iconCropState.x * 1.333, iconCropState.y * 1.333, drawSize, drawSize);
    return canvas.toDataURL("image/webp", 0.82);
}

async function saveMemberRegistration() {
    if (!requireGoogleAuth()) return;
    const email = document.getElementById("member-email").value;
    const memberId = readCodeParts("member-id");
    const password = document.getElementById("member-password").value;
    const displayName = document.getElementById("member-display-name").value.trim();
    if (!password || !displayName) return alert("パスワードと表示名前を入力してください。");
    const passwordError = validatePasswordStrength(password);
    if (passwordError) return alert(passwordError);
    try {
        if (memberId) await verifyInviteCodeForCurrentUser(memberId);
        const passwordHash = await hashPassword(password);
        const iconDataUrl = await getCroppedIconDataUrl();
        await db.collection("memberProfiles").doc(auth.currentUser.uid).set({
            email,
            googleUid: auth.currentUser.uid,
            memberId,
            passwordHash,
            passwordHashVersion: 2,
            displayName,
            iconDataUrl,
            surveyOptIn: document.getElementById("survey-opt-in").checked,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        if (memberId) await redeemInviteCodeValue(memberId, false);
        if (document.getElementById("survey-opt-in").checked) {
            await saveSurveyResponse("survey", false);
        }
        alert("会員登録が完了しました。");
        settingsUnlocked = true;
        switchWindow("settings");
    } catch (error) {
        alert(error.message === "ID照合に失敗しました。" ? error.message : `会員登録に失敗しました: ${error.message}`);
    }
}

function collectSurveyResponse(prefix) {
    const device = document.getElementById(`${prefix}-device`)?.value || "";
    return {
        email: auth.currentUser?.email || "",
        birthYear: document.getElementById(`${prefix}-birth-year`)?.value.trim() || "",
        birthMonth: document.getElementById(`${prefix}-birth-month`)?.value.trim() || "",
        birthDay: document.getElementById(`${prefix}-birth-day`)?.value.trim() || "",
        gender: document.getElementById(`${prefix}-gender`)?.value || "",
        device,
        deviceOther: device === "other" ? (document.getElementById(`${prefix}-device-other`)?.value.trim() || "") : "",
        discovery: document.getElementById(`${prefix}-discovery`)?.value.trim() || "",
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
}

async function saveSurveyResponse(prefix, requireAccount = true) {
    if (requireAccount && !requireServiceAccount()) return;
    if (!requireAccount && !requireGoogleAuth()) return;
    const response = collectSurveyResponse(prefix);
    if (!response.email) throw new Error("メールアドレスを取得できませんでした。");
    await db.collection("registrationSurveys").doc(response.email).set(response, { merge: true });
}

async function submitStandaloneSurvey() {
    try {
        await saveSurveyResponse("standalone-survey");
        alert("アンケートを送信しました。ご協力ありがとうございます。");
    } catch (error) {
        alert(`アンケート送信に失敗しました: ${error.message}`);
    }
}

async function verifyInviteCodeForCurrentUser(code) {
    try {
        const doc = await db.collection("roleInvites").doc(formatInviteCode(code)).get();
        if (!doc.exists) throw new Error("ID照合に失敗しました。");
        const invite = doc.data();
        if (invite.allowedEmail && invite.allowedEmail !== auth.currentUser.email) throw new Error("ID照合に失敗しました。");
        if (invite.used && invite.usedBy !== auth.currentUser.uid) throw new Error("ID照合に失敗しました。");
        return invite;
    } catch {
        throw new Error("ID照合に失敗しました。");
    }
}

async function saveUserSettings() {
    if (!requireServiceAccount()) return;
    if (!settingsUnlocked) return switchWindow("settings");
    const displayName = document.getElementById("settings-display-name").value.trim();
    const memberId = readCodeParts("settings-member-id");
    const oldPassword = document.getElementById("settings-old-password").value;
    const newPassword = document.getElementById("settings-new-password").value;
    const newPasswordConfirm = document.getElementById("settings-new-password-confirm").value;
    if (!displayName) return alert("表示名前を入力してください。");
    try {
        const update = { displayName, updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
        if (memberId && memberId !== currentProfile?.memberId) {
            await verifyInviteCodeForCurrentUser(memberId);
            await redeemInviteCodeValue(memberId, false);
            update.memberId = formatInviteCode(memberId);
        } else if (!memberId && currentProfile?.memberId) {
            update.memberId = "";
        }
        if (newPassword || newPasswordConfirm || oldPassword) {
            const oldMatch = await passwordMatchesStored(oldPassword);
            if (!oldMatch.ok) throw new Error("旧パスワードが違います。");
            if (newPassword !== newPasswordConfirm) throw new Error("新パスワードが一致しません。");
            const passwordError = validatePasswordStrength(newPassword);
            if (passwordError) throw new Error(passwordError);
            update.passwordHash = await hashPassword(newPassword);
            update.passwordHashVersion = 2;
        } else if (currentProfile?.passwordHashVersion !== 2) {
            const gatePassword = document.getElementById("settings-gate-password")?.value;
            if (gatePassword) {
                const oldMatch = await passwordMatchesStored(gatePassword);
                if (oldMatch.needsMigration) {
                    update.passwordHash = oldMatch.migratedHash;
                    update.passwordHashVersion = 2;
                }
            }
        }
        const croppedIcon = await getCroppedIconDataUrl();
        if (croppedIcon) update.iconDataUrl = croppedIcon;
        await db.collection("memberProfiles").doc(auth.currentUser.uid).set(update, { merge: true });
        ["settings-old-password", "settings-new-password", "settings-new-password-confirm"].forEach(id => document.getElementById(id).value = "");
        alert("設定を保存しました。");
    } catch (error) {
        alert(error.message === "ID照合に失敗しました。" ? error.message : `設定保存に失敗しました: ${error.message}`);
    }
}

async function redeemInviteCodeValue(code, showAlert = true) {
    const normalized = formatInviteCode(code);
    const inviteRef = db.collection("roleInvites").doc(normalized);
    const roleRef = db.collection("userRoles").doc(auth.currentUser.uid);
    const role = await db.runTransaction(async transaction => {
        const inviteDoc = await transaction.get(inviteRef);
        if (!inviteDoc.exists) throw new Error("ID照合に失敗しました。");
        const invite = inviteDoc.data();
        if (invite.allowedEmail && invite.allowedEmail !== auth.currentUser.email) throw new Error("ID照合に失敗しました。");
        if (invite.used && invite.usedBy !== auth.currentUser.uid) throw new Error("ID照合に失敗しました。");
        transaction.set(roleRef, { role: invite.role, grantedByInvite: normalized, grantedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
        transaction.update(inviteRef, { used: true, usedBy: auth.currentUser.uid, usedAt: firebase.firestore.FieldValue.serverTimestamp() });
        return invite.role;
    });
    if (showAlert) alert(`${ROLE_LABELS[role]} 権限を登録しました。`);
    return role;
}

function loadUserProgress(uid) {
    progressUnsubscribe = db.collection("users").doc(uid).onSnapshot(doc => {
        if (doc.exists) userProgress = { ...userProgress, ...(doc.data().progress || {}) };
        else db.collection("users").doc(uid).set({ progress: userProgress, createdAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
        updateProgressUI();
        renderSecretButtons();
    }, console.error);
}

function discoverKeyword(locationId, char) {
    const secretCard = document.querySelector(`[data-secret-location="${locationId}"]`);
    userProgress[locationId] = true;
    if (secretCard) {
        const value = secretCard.querySelector("[data-secret-value]");
        const hint = secretCard.querySelector("[data-secret-hint]");
        if (value) {
            value.classList.remove("sr-only", "opacity-0");
            value.textContent = char;
        }
        if (hint) hint.textContent = "発見";
    }
    if (auth.currentUser) db.collection("users").doc(auth.currentUser.uid).set({ progress: userProgress }, { merge: true });
    updateProgressUI();
}

function updateProgressUI() {
    const foundCount = Object.values(userProgress).filter(Boolean).length;
    const percent = Math.floor((foundCount / 5) * 100);
    const percentText = document.getElementById("explore-percent");
    const progressBar = document.getElementById("explore-bar");
    if (percentText) percentText.innerText = `${percent}%`;
    if (progressBar) progressBar.style.width = `${percent}%`;
}

function renderSecretButtons() {
    Object.entries(SECRET_KEYWORDS).forEach(([locationId, char]) => {
        const secretCard = document.querySelector(`[data-secret-location="${locationId}"]`);
        if (!secretCard) return;
        const value = secretCard.querySelector("[data-secret-value]");
        const hint = secretCard.querySelector("[data-secret-hint]");
        if (value) value.textContent = userProgress[locationId] ? char : "クリック";
        if (hint) hint.textContent = userProgress[locationId] ? "発見" : "・";
    });
}

function openPasswordModal() {
    const password = prompt("5つの場所で見つけた文字をつなげたパスワードを入力してください。");
    if (password === null) return;
    alert(password === "輝空いねい" ? "パスワード解除完了: ETOILE_2026" : "パスワードが違います。");
}

function unlockSecret() {
    discoverKeyword("home", SECRET_KEYWORDS.home);
}

function startAnnouncementListener() {
    db.collection("announcements").orderBy("createdAt", "desc").limit(20).onSnapshot(snapshot => {
        cachedAnnouncements = [];
        snapshot.forEach(doc => cachedAnnouncements.push({ id: doc.id, ...doc.data() }));
        renderAnnouncements();
        renderOpsTables();
    }, console.error);
}

function renderAnnouncements() {
    const list = document.getElementById("announcement-list");
    if (!list) return;
    const now = Date.now();
    const visible = cachedAnnouncements.filter(item => !item.publishAtMillis || item.publishAtMillis <= now);
    list.innerHTML = visible.length
        ? visible.slice(0, 5).map(item => `
            <article class="rounded-xl border border-sky-100 bg-gradient-to-br from-white to-sky-50/70 p-4 shadow-sm">
                <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0">
                        <p class="text-[11px] font-bold tracking-[0.16em] text-sky-400">ADMIN NOTICE</p>
                        <h4 class="mt-1 text-sm font-bold text-sky-900 break-words">${escapeHtml(item.title || "お知らせ")}</h4>
                    </div>
                    <span class="shrink-0 rounded-full bg-sky-100 px-2 py-1 text-[10px] font-bold text-sky-600">${item.publishAtMillis ? new Date(item.publishAtMillis).toLocaleDateString() : "公開中"}</span>
                </div>
                <p class="mt-3 text-sm leading-6 text-gray-700 whitespace-pre-wrap break-words">${escapeHtml(item.body || "")}</p>
                ${item.url ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" class="mt-3 inline-flex items-center rounded-lg bg-sky-500 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-sky-600">関連リンクを開く</a>` : ""}
            </article>
        `).join("")
        : `<p class="text-xs text-gray-400">現在、お知らせはありません。</p>`;
}

async function loadHomeYouTubeCard() {
    const titleEl = document.getElementById("home-youtube-title");
    const dateEl = document.getElementById("home-youtube-date");
    const thumbEl = document.getElementById("home-youtube-thumb");
    const linkEl = document.getElementById("home-youtube-link");
    const badgeEl = document.getElementById("home-youtube-badge");
    const statusEl = document.getElementById("home-youtube-status");
    if (!titleEl || !dateEl || !thumbEl || !linkEl) return;

    const fallback = () => {
        titleEl.textContent = "Aureole Etoile YouTube チャンネル";
        dateEl.innerHTML = `<i class="far fa-calendar-alt mr-1"></i>最新情報はYouTubeで確認できます`;
        linkEl.href = YOUTUBE_CHANNEL_URL;
        if (badgeEl) badgeEl.textContent = "CHANNEL";
        if (statusEl) statusEl.textContent = YOUTUBE_API_KEY && YOUTUBE_CHANNEL_ID ? "" : "YouTube Data APIキーとチャンネルIDを設定すると、最新のサムネイルとタイトルを自動表示します。";
    };

    if (!YOUTUBE_API_KEY || !YOUTUBE_CHANNEL_ID) {
        fallback();
        return;
    }

    try {
        const params = new URLSearchParams({
            key: YOUTUBE_API_KEY,
            channelId: YOUTUBE_CHANNEL_ID,
            part: "snippet",
            order: "date",
            type: "video",
            maxResults: "1"
        });
        const response = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
        if (!response.ok) throw new Error(`YouTube API ${response.status}`);
        const data = await response.json();
        const item = data.items?.[0];
        if (!item) throw new Error("No YouTube item");
        const snippet = item.snippet || {};
        titleEl.textContent = snippet.title || "最新のYouTube動画";
        dateEl.innerHTML = `<i class="far fa-calendar-alt mr-1"></i>${snippet.publishedAt ? new Date(snippet.publishedAt).toLocaleString() : ""}`;
        thumbEl.src = snippet.thumbnails?.high?.url || snippet.thumbnails?.medium?.url || thumbEl.src;
        linkEl.href = `https://www.youtube.com/watch?v=${item.id.videoId}`;
        if (badgeEl) badgeEl.textContent = "LATEST";
        if (statusEl) statusEl.textContent = "YouTube Data APIから最新情報を取得しました。";
    } catch (error) {
        fallback();
        if (statusEl) statusEl.textContent = `YouTube情報を取得できませんでした: ${error.message}`;
    }
}

function startXFeedListener() {
    const list = document.getElementById("x-feed-list");
    if (!list) return;
    db.collection("xPosts").orderBy("createdAt", "desc").limit(30).onSnapshot(snapshot => {
        cachedXPosts = [];
        snapshot.forEach(doc => cachedXPosts.push({ id: doc.id, ...doc.data() }));
        renderXFeed();
    }, error => {
        list.innerHTML = `<p class="text-xs text-gray-400">Xポストを読み込めませんでした。</p>`;
        console.error(error);
    });
}

function renderXFeed() {
    const list = document.getElementById("x-feed-list");
    if (!list) return;
    const visible = cachedXPosts.filter(item => item.isReply !== true).slice(0, 5);
    list.innerHTML = visible.length
        ? visible.map(item => `
            <article class="rounded-xl border border-sky-100 bg-sky-50/50 p-3">
                <p class="text-xs font-bold text-sky-800">${escapeHtml(item.accountName || item.handle || "X")}${item.handle ? ` <span class="font-normal text-gray-400">@${escapeHtml(String(item.handle).replace(/^@/, ""))}</span>` : ""}</p>
                <p class="mt-1 text-xs text-gray-700 whitespace-pre-wrap">${escapeHtml(item.text || "")}</p>
                ${item.url ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" class="mt-2 inline-block text-[11px] font-bold text-sky-500">Xで開く</a>` : ""}
            </article>
        `).join("")
        : `<p class="text-xs text-gray-400">表示できるXポストはまだ登録されていません。返信ポストは表示対象外です。</p>`;
}

function startEventsListener() {
    db.collection("events").orderBy("createdAt", "desc").limit(50).onSnapshot(snapshot => {
        cachedEvents = [];
        snapshot.forEach(doc => cachedEvents.push({ id: doc.id, ...doc.data() }));
        renderEvents();
        renderOpsTables();
    }, console.error);
}

function renderEvents() {
    const list = document.getElementById("events-list");
    if (!list) return;
    const visibleEvents = cachedEvents.filter(event => event.status !== "archived");
    list.innerHTML = visibleEvents.length
        ? visibleEvents.map(event => `
            <article class="bg-sky-50 rounded-xl p-4 border border-sky-100">
                <h4 class="text-sm font-bold text-sky-900">${escapeHtml(event.title)}</h4>
                <p class="text-xs text-gray-600 mt-1 whitespace-pre-wrap">${escapeHtml(event.body)}</p>
                <p class="text-[11px] text-gray-400 mt-2">種別: ${escapeHtml(event.type || "notice")}</p>
            </article>
        `).join("")
        : "";
}

function startRunnerGame() {
    if (window.StarRunner) {
        window.StarRunner.start();
        return;
    }
    const canvas = document.getElementById("runner-game");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    runnerState = {
        running: true,
        score: 0,
        speed: 5,
        player: { x: 52, y: 166, w: 26, h: 34, vy: 0, grounded: true },
        obstacles: [{ x: 640, y: 172, w: 22, h: 28 }],
        lastTime: performance.now()
    };
    const status = document.getElementById("runner-status");
    if (status) status.textContent = "プレイ中";
    requestAnimationFrame(runRunnerFrame);
}

function runnerJump() {
    if (window.StarRunner) {
        window.StarRunner.jump();
        return;
    }
    if (!runnerState?.running) return;
    if (runnerState.player.grounded) {
        runnerState.player.vy = -13;
        runnerState.player.grounded = false;
    }
}

function runRunnerFrame(time) {
    if (!runnerState?.running) return;
    const canvas = document.getElementById("runner-game");
    const ctx = canvas.getContext("2d");
    const dt = Math.min(32, time - runnerState.lastTime) / 16.67;
    runnerState.lastTime = time;
    runnerState.score += Math.floor(dt);
    runnerState.speed = 5 + Math.min(7, runnerState.score / 500);

    const p = runnerState.player;
    p.vy += 0.72 * dt;
    p.y += p.vy * dt;
    if (p.y >= 166) {
        p.y = 166;
        p.vy = 0;
        p.grounded = true;
    }

    runnerState.obstacles.forEach(obstacle => obstacle.x -= runnerState.speed * dt);
    const last = runnerState.obstacles[runnerState.obstacles.length - 1];
    if (last.x < 420) {
        const h = 22 + Math.floor(Math.random() * 22);
        runnerState.obstacles.push({ x: 640 + Math.random() * 100, y: 200 - h, w: 18 + Math.random() * 12, h });
    }
    runnerState.obstacles = runnerState.obstacles.filter(obstacle => obstacle.x > -40);

    const hit = runnerState.obstacles.some(o => p.x < o.x + o.w && p.x + p.w > o.x && p.y < o.y + o.h && p.y + p.h > o.y);
    drawRunner(ctx, canvas);
    const score = document.getElementById("runner-score");
    if (score) score.textContent = runnerState.score;
    if (hit) {
        runnerState.running = false;
        const status = document.getElementById("runner-status");
        if (status) status.textContent = "ゲームオーバー";
        return;
    }
    requestAnimationFrame(runRunnerFrame);
}

function drawRunner(ctx, canvas) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#e0f2fe";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#bae6fd";
    for (let x = -((runnerState.score * 2) % 80); x < canvas.width; x += 80) ctx.fillRect(x, 198, 42, 3);
    ctx.fillStyle = "#0ea5e9";
    const p = runnerState.player;
    ctx.fillRect(p.x, p.y, p.w, p.h);
    ctx.fillStyle = "#f59e0b";
    runnerState.obstacles.forEach(o => ctx.fillRect(o.x, o.y, o.w, o.h));
    ctx.fillStyle = "#075985";
    ctx.font = "14px sans-serif";
    ctx.fillText(`SCORE ${runnerState.score}`, 16, 24);
}

function opsRunnerDebug(mode) {
    if (window.StarRunner) {
        window.StarRunner.debug(mode);
    }
    const log = document.getElementById("ops-game-debug-log");
    if (log) log.textContent = `Star Runner debug preset: ${mode} / ${new Date().toLocaleTimeString()}`;
    logOps("game.debug", { game: "star-runner", mode });
}

function startTimelineListener() {
    db.collection("posts").onSnapshot(snapshot => {
        cachedPosts = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            if (!data.deletedByRequests) cachedPosts.push({ id: doc.id, ...data });
        });
        cachedPosts.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
        renderTimeline(cachedPosts);
    }, console.error);
}

function renderTimeline(posts) {
    const list = document.getElementById("timeline-list");
    if (!list) return;
    list.innerHTML = "";
    posts.forEach(post => {
        const urlCheck = validateYouTubeUrl(post.url || "");
        const safeUrl = urlCheck.ok ? urlCheck.normalized : "#";
        const requestCount = Array.isArray(post.deleteRequestedBy) ? post.deleteRequestedBy.length : (post.requests || 0);
        const alreadyRequested = auth.currentUser && Array.isArray(post.deleteRequestedBy) && post.deleteRequestedBy.includes(auth.currentUser.uid);
        const postLiked = auth.currentUser && Array.isArray(post.likedBy) && post.likedBy.includes(auth.currentUser.uid);
        const postLikeCount = Array.isArray(post.likedBy) ? post.likedBy.length : (post.likeCount || 0);
        const replyCount = post.replyCount || 0;
        const visibleReplies = (post.replies || []).filter(reply => !reply.deletedByRequests).slice(-50);
        const repliesOpen = openReplyThreads.has(post.id);
        const actionButton = canDeletePosts()
            ? `<button onclick="deletePost('${post.id}')" class="text-red-500 hover:text-red-700 font-bold">削除</button>`
            : `<button onclick="requestDelete('${post.id}')" ${alreadyRequested ? "disabled" : ""} class="text-red-400 hover:text-red-600 font-bold disabled:text-gray-300 disabled:cursor-not-allowed">削除申請 (${requestCount}/3)</button>`;
        const card = document.createElement("div");
        card.className = "bg-white rounded-2xl p-4 shadow-sm border border-sky-100";
        card.innerHTML = `
            <div class="flex items-start gap-3">
                <div class="flex-1 min-w-0">
                    <div class="flex justify-between items-start text-xs text-gray-400 mb-1 gap-2">
                        <span class="min-w-0 flex items-center gap-2 font-bold text-sky-600">
                            ${post.iconDataUrl ? `<img src="${escapeHtml(post.iconDataUrl)}" class="w-8 h-8 rounded-full object-cover border border-sky-100 shrink-0" alt="">` : `<span class="w-8 h-8 rounded-full bg-sky-100 text-sky-500 grid place-items-center shrink-0"><i class="fas fa-user"></i></span>`}
                            <span class="truncate">${escapeHtml(post.user || "匿名ユーザー")}</span>
                            ${getRoleBadge(post.roleAtPost || "general")}
                        </span>
                        <span class="text-[10px] font-mono text-gray-300">ID: ${escapeHtml(post.id.substring(0, 6))}...</span>
                    </div>
                    <p class="text-sm text-gray-700 break-all whitespace-pre-wrap">${escapeHtml(post.text || "")}</p>
                    <a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer" class="mt-2 inline-block text-xs text-sky-500 bg-sky-50 px-2.5 py-1 rounded-lg font-medium hover:bg-sky-100"><i class="fas fa-play-circle mr-1"></i>YouTubeを開く</a>
                    <div class="mt-3 border-t border-gray-50 pt-2 flex items-center justify-between text-[11px] text-gray-400">
                        <div class="flex items-center gap-3">
                            <button onclick="toggleReplies('${post.id}')" class="hover:text-sky-500 font-bold"><i class="far fa-comment-dots mr-1"></i>返信 ${Math.min(replyCount, 50)} / 50 件</button>
                            <button onclick="likePost('${post.id}')" ${postLiked ? "disabled" : ""} class="hover:text-rose-500 font-bold disabled:text-rose-400 disabled:cursor-not-allowed"><i class="${postLiked ? "fas" : "far"} fa-heart mr-1"></i>${postLikeCount}</button>
                        </div>
                        <div>${actionButton}</div>
                    </div>
                    <div id="replies-${post.id}" class="${repliesOpen ? "" : "hidden"} mt-3 pl-4 border-l-2 border-sky-100 space-y-3">
                        <div class="flex justify-end">
                            <button onclick="closeReplies('${post.id}')" class="rounded-full border border-sky-100 px-3 py-1 text-[11px] font-bold text-sky-500 hover:bg-sky-50">返信を閉じる</button>
                        </div>
                        <div class="space-y-2">
                            ${visibleReplies.map((reply, index) => {
                                const replyId = reply.id || `legacy-${index}`;
                                const likedBy = Array.isArray(reply.likedBy) ? reply.likedBy : [];
                                const deleteRequestedBy = Array.isArray(reply.deleteRequestedBy) ? reply.deleteRequestedBy : [];
                                const replyLiked = auth.currentUser && likedBy.includes(auth.currentUser.uid);
                                const replyRequested = auth.currentUser && deleteRequestedBy.includes(auth.currentUser.uid);
                                const replyActions = canDeletePosts()
                                    ? `<button onclick="deleteReply('${post.id}', '${replyId}')" class="text-red-400 hover:text-red-600 font-bold">削除</button>`
                                    : `<button onclick="requestDeleteReply('${post.id}', '${replyId}')" ${replyRequested ? "disabled" : ""} class="text-red-300 hover:text-red-500 font-bold disabled:text-gray-300 disabled:cursor-not-allowed">削除申請 (${deleteRequestedBy.length}/3)</button>`;
                                return `<article class="rounded-xl bg-sky-50/60 px-3 py-2">
                                    <div class="flex items-center justify-between gap-2">
                                        <span class="min-w-0 flex items-center gap-2 text-[11px] font-bold text-sky-700">
                                            ${reply.iconDataUrl ? `<img src="${escapeHtml(reply.iconDataUrl)}" class="w-6 h-6 rounded-full object-cover border border-sky-100 shrink-0" alt="">` : `<span class="w-6 h-6 rounded-full bg-white text-sky-400 grid place-items-center shrink-0"><i class="fas fa-user text-[10px]"></i></span>`}
                                            <span class="truncate">${escapeHtml(reply.user || "匿名ユーザー")}</span>
                                        </span>
                                        ${getRoleBadge(reply.roleAtReply || "general")}
                                    </div>
                                    <p class="text-xs text-gray-700 whitespace-pre-wrap break-all">${escapeHtml(reply.text || "")}</p>
                                    <div class="mt-2 flex items-center justify-between text-[11px] text-gray-400">
                                        <button onclick="likeReply('${post.id}', '${replyId}')" ${replyLiked ? "disabled" : ""} class="hover:text-rose-500 font-bold disabled:text-rose-400 disabled:cursor-not-allowed"><i class="${replyLiked ? "fas" : "far"} fa-heart mr-1"></i>${likedBy.length}</button>
                                        ${replyActions}
                                    </div>
                                </article>`;
                            }).join("")}
                        </div>
                        ${replyCount >= 50 ? `<p class="text-[11px] text-gray-400">返信が50件に達したため、新しい返信ボタンは表示できません。</p>` : `<div class="flex gap-2"><textarea id="reply-input-${post.id}" maxlength="200" rows="1" class="flex-1 bg-white border border-sky-100 rounded-xl p-2 text-xs focus:outline-none focus:border-sky-400" placeholder="返信を投稿"></textarea><button onclick="addReply('${post.id}')" class="bg-sky-500 hover:bg-sky-600 text-white text-xs font-bold px-3 rounded-xl">返信</button></div>`}
                    </div>
                </div>
            </div>
        `;
        list.appendChild(card);
    });
}

function addPost() {
    if (!requireServiceAccount()) return;
    const textInput = document.getElementById("post-text");
    const urlInput = document.getElementById("post-url");
    const text = textInput.value.trim();
    const urlResult = validateYouTubeUrl(urlInput.value);
    if (!text || !urlInput.value.trim()) return alert("内容とYouTube URLを入力してください。");
    if (!urlResult.ok) return alert(urlResult.message);
    db.collection("posts").add({
        user: getDisplayName(),
        iconDataUrl: currentProfile?.iconDataUrl || "",
        uid: auth.currentUser.uid,
        roleAtPost: currentRole,
        text,
        url: urlResult.normalized,
        requests: 0,
        deleteRequestedBy: [],
        likedBy: [],
        likeCount: 0,
        replies: [],
        replyCount: 0,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(() => {
        textInput.value = "";
        urlInput.value = "";
    }).catch(error => alert(`投稿に失敗しました: ${error.message}`));
}

function deletePost(postId) {
    if (!auth.currentUser || !canDeletePosts()) return alert("削除権限がありません。");
    if (confirm("この投稿を削除しますか？")) db.collection("posts").doc(postId).delete().then(() => alert("削除しました。"));
}

function requestDelete(postId) {
    if (!requireServiceAccount()) return;
    const postRef = db.collection("posts").doc(postId);
    db.runTransaction(async transaction => {
        const doc = await transaction.get(postRef);
        if (!doc.exists) throw new Error("投稿が見つかりません。");
        const requestedBy = Array.isArray(doc.data().deleteRequestedBy) ? doc.data().deleteRequestedBy : [];
        if (requestedBy.includes(auth.currentUser.uid)) return "already";
        const nextRequestedBy = [...requestedBy, auth.currentUser.uid];
        transaction.update(postRef, nextRequestedBy.length >= 3
            ? { deleteRequestedBy: nextRequestedBy, requests: nextRequestedBy.length, deletedByRequests: true, deletedAt: firebase.firestore.FieldValue.serverTimestamp() }
            : { deleteRequestedBy: nextRequestedBy, requests: nextRequestedBy.length }
        );
        return nextRequestedBy.length >= 3 ? "deleted" : "requested";
    }).then(result => {
        if (result === "already") alert("このコメントへの削除申請はすでに送信済みです。");
        if (result === "deleted") alert("削除申請が3件に達したため非表示になりました。");
        if (result === "requested") alert("削除申請を送信しました。");
    }).catch(error => alert(`削除申請に失敗しました: ${error.message}`));
}

function toggleReplies(postId) {
    if (openReplyThreads.has(postId)) {
        openReplyThreads.delete(postId);
    } else {
        openReplyThreads.add(postId);
    }
    const target = document.getElementById(`replies-${postId}`);
    if (target) target.classList.toggle("hidden", !openReplyThreads.has(postId));
}

function closeReplies(postId) {
    openReplyThreads.delete(postId);
    const target = document.getElementById(`replies-${postId}`);
    if (target) target.classList.add("hidden");
}

function addReply(postId) {
    if (!requireServiceAccount()) return;
    openReplyThreads.add(postId);
    const input = document.getElementById(`reply-input-${postId}`);
    const text = input?.value.trim();
    if (!text) return alert("返信内容を入力してください。");
    const postRef = db.collection("posts").doc(postId);
    db.runTransaction(async transaction => {
        const doc = await transaction.get(postRef);
        if (!doc.exists) throw new Error("投稿が見つかりません。");
        const replyCount = doc.data().replyCount || 0;
        const reply = {
            id: makeId("reply"),
            text,
            uid: auth.currentUser.uid,
            user: getDisplayName(),
            iconDataUrl: currentProfile?.iconDataUrl || "",
            roleAtReply: currentRole,
            likedBy: [],
            deleteRequestedBy: [],
            createdAt: new Date().toISOString()
        };
        if (replyCount >= 50) {
            transaction.update(postRef, { hiddenReplies: firebase.firestore.FieldValue.arrayUnion(reply), hiddenReplyCount: firebase.firestore.FieldValue.increment(1) });
            return "overflow";
        }
        transaction.update(postRef, { replies: firebase.firestore.FieldValue.arrayUnion(reply), replyCount: firebase.firestore.FieldValue.increment(1) });
        return "posted";
    }).then(result => {
        if (result === "posted") {
            input.value = "";
            return;
        }
        showReplyOverflowChoice(text);
    }).catch(error => alert(`返信に失敗しました: ${error.message}`));
}

function showReplyOverflowChoice(text) {
    if (!confirm("返信は50件を超えたため画面には登録できませんでした。入力した文章をクリップボードにコピーしますか？")) return;
    navigator.clipboard.writeText(text).then(() => alert("クリップボードにコピーしました。")).catch(() => alert(`コピーに失敗しました。本文:\n${text}`));
}

function likePost(postId) {
    if (!requireServiceAccount()) return;
    const postRef = db.collection("posts").doc(postId);
    db.runTransaction(async transaction => {
        const doc = await transaction.get(postRef);
        if (!doc.exists) throw new Error("投稿が見つかりません。");
        const likedBy = Array.isArray(doc.data().likedBy) ? doc.data().likedBy : [];
        if (likedBy.includes(auth.currentUser.uid)) return;
        transaction.update(postRef, {
            likedBy: [...likedBy, auth.currentUser.uid],
            likeCount: likedBy.length + 1
        });
    }).catch(error => alert(`いいねに失敗しました: ${error.message}`));
}

function updateReplyInPost(postId, replyId, updater) {
    const postRef = db.collection("posts").doc(postId);
    return db.runTransaction(async transaction => {
        const doc = await transaction.get(postRef);
        if (!doc.exists) throw new Error("投稿が見つかりません。");
        const replies = Array.isArray(doc.data().replies) ? [...doc.data().replies] : [];
        const index = replies.findIndex((reply, fallbackIndex) => (reply.id || `legacy-${fallbackIndex}`) === replyId);
        if (index < 0) throw new Error("返信が見つかりません。");
        replies[index] = updater({ ...replies[index] });
        transaction.update(postRef, { replies });
    });
}

function likeReply(postId, replyId) {
    if (!requireServiceAccount()) return;
    openReplyThreads.add(postId);
    updateReplyInPost(postId, replyId, reply => {
        const likedBy = Array.isArray(reply.likedBy) ? reply.likedBy : [];
        if (!likedBy.includes(auth.currentUser.uid)) reply.likedBy = [...likedBy, auth.currentUser.uid];
        return reply;
    }).catch(error => alert(`いいねに失敗しました: ${error.message}`));
}

function requestDeleteReply(postId, replyId) {
    if (!requireServiceAccount()) return;
    openReplyThreads.add(postId);
    updateReplyInPost(postId, replyId, reply => {
        const requestedBy = Array.isArray(reply.deleteRequestedBy) ? reply.deleteRequestedBy : [];
        if (requestedBy.includes(auth.currentUser.uid)) return reply;
        reply.deleteRequestedBy = [...requestedBy, auth.currentUser.uid];
        if (reply.deleteRequestedBy.length >= 3) reply.deletedByRequests = true;
        return reply;
    }).then(() => alert("返信の削除申請を送信しました。")).catch(error => alert(`削除申請に失敗しました: ${error.message}`));
}

function deleteReply(postId, replyId) {
    if (!auth.currentUser || !canDeletePosts()) return alert("削除権限がありません。");
    if (!confirm("この返信を削除しますか？")) return;
    updateReplyInPost(postId, replyId, reply => ({ ...reply, deletedByRequests: true, deletedByRole: currentRole }))
        .then(() => alert("返信を削除しました。"))
        .catch(error => alert(`削除に失敗しました: ${error.message}`));
}

async function logOps(action, detail = {}) {
    if (!auth.currentUser) return;
    await db.collection("opsLogs").add({
        action,
        detail,
        actorUid: auth.currentUser.uid,
        actorName: getDisplayName(),
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }).catch(console.error);
}

function switchOpsTab(tabId) {
    document.querySelectorAll(".ops-tab-panel").forEach(panel => panel.classList.add("hidden"));
    const panel = document.getElementById(`ops-tab-${tabId}`);
    if (panel) panel.classList.remove("hidden");
    document.querySelectorAll(".ops-tab-btn").forEach(button => button.classList.toggle("bg-slate-700", button.dataset.opsTab === tabId));
}

function addAnnouncementFromOps() {
    if (!auth.currentUser || !canUseOpsPortal()) return alert("操作権限がありません。");
    const title = document.getElementById("ops-announcement-title").value.trim();
    const body = document.getElementById("ops-announcement-body").value.trim();
    const url = document.getElementById("ops-announcement-url")?.value.trim() || "";
    const publishMode = document.querySelector("input[name='ops-announcement-publish']:checked")?.value || "now";
    const scheduled = document.getElementById("ops-announcement-scheduled")?.value || "";
    if (!title || !body) return alert("タイトルと本文を入力してください。");
    const publishAtMillis = publishMode === "scheduled" && scheduled ? new Date(scheduled).getTime() : Date.now();
    db.collection("announcements").add({
        title, body, url, publishMode, publishAtMillis,
        authorUid: auth.currentUser.uid,
        authorName: getDisplayName(),
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(() => {
        ["ops-announcement-title", "ops-announcement-body", "ops-announcement-url"].forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
        logOps("announcement.create", { title });
    }).catch(error => alert(error.message));
}

function addEventFromOps() {
    if (!auth.currentUser || !canUseOpsPortal()) return alert("操作権限がありません。");
    const title = document.getElementById("ops-event-title").value.trim();
    const body = document.getElementById("ops-event-body").value.trim();
    const type = document.getElementById("ops-event-type")?.value || "notice";
    const status = document.getElementById("ops-event-status")?.value || "active";
    if (!title || !body) return alert("イベント名と本文を入力してください。");
    db.collection("events").add({
        title, body, type, status,
        authorUid: auth.currentUser.uid,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(() => {
        ["ops-event-title", "ops-event-body"].forEach(id => document.getElementById(id).value = "");
        logOps("event.create", { title, type, status });
    }).catch(error => alert(error.message));
}

function createInviteCodeFromOps() {
    if (!auth.currentUser || !canUseOpsPortal()) return alert("操作権限がありません。");
    const code = formatInviteCode(readCodeParts("ops-invite-code"));
    const role = document.getElementById("ops-invite-role").value;
    const email = document.getElementById("ops-invite-email").value.trim();
    if (normalizeInviteCode(code).length !== 12) return alert("会員IDは4桁-4桁-4桁で入力してください。");
    if (!email || !email.includes("@")) return alert("Gmailアドレスを入力してください。");
    if (!["fan", "aureole", "admin"].includes(role)) return alert("権限を選択してください。");
    db.collection("roleInvites").doc(code).set({
        role,
        allowedEmail: email,
        used: false,
        issuedBy: auth.currentUser.uid,
        issuedAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(() => {
        const text = `会員IDが発行されました。\n登録されたGmailアドレス：${email}\n会員：${ROLE_LABELS[role]}\n会員ID：${code}\n\n※会員IDは発行順ではない、ランダムな値です。なお再発行にはお時間をいただきますので、必ずどこかに記録・メモを行ってください。`;
        const output = document.getElementById("ops-invite-copy-text");
        if (output) output.value = text;
        writeCodeParts("ops-invite-code", "");
        logOps("invite.create", { role, allowedEmail: email, codeMasked: maskCode(code) });
    }).catch(error => alert(error.message));
}

function maskCode(code) {
    const raw = normalizeInviteCode(code);
    return `${raw.slice(0, 4)}-****-${raw.slice(8, 12)}`;
}

function copyInviteText() {
    const text = document.getElementById("ops-invite-copy-text")?.value || "";
    if (!text) return alert("コピーする文章がありません。");
    navigator.clipboard.writeText(text).then(() => alert("コピーしました。"));
}

function renderOpsIfPresent() {
    const guard = document.getElementById("ops-guard");
    const panel = document.getElementById("ops-panel");
    if (!guard || !panel) return;
    const allowed = !!auth.currentUser && canUseOpsPortal();
    guard.classList.toggle("hidden", allowed);
    panel.classList.toggle("hidden", !allowed);
    renderOpsTables();
    if (allowed) loadSurveyLogsForOps();
}

function renderOpsTables() {
    const announcementTable = document.getElementById("ops-announcement-table");
    if (announcementTable) {
        announcementTable.innerHTML = cachedAnnouncements.map(item => `<tr class="border-t border-slate-800"><td class="py-2 pr-3">${escapeHtml(item.title || "")}</td><td class="py-2 pr-3">${item.publishAtMillis ? new Date(item.publishAtMillis).toLocaleString() : "即時"}</td><td class="py-2">${item.url ? "あり" : "なし"}</td></tr>`).join("") || `<tr><td class="py-2 text-slate-500" colspan="3">ログなし</td></tr>`;
    }
    const eventTable = document.getElementById("ops-event-table");
    if (eventTable) {
        eventTable.innerHTML = cachedEvents.map(item => `<tr class="border-t border-slate-800"><td class="py-2 pr-3">${escapeHtml(item.title || "")}</td><td class="py-2 pr-3">${escapeHtml(item.type || "")}</td><td class="py-2">${escapeHtml(item.status || "")}</td></tr>`).join("") || `<tr><td class="py-2 text-slate-500" colspan="3">ログなし</td></tr>`;
    }
}

function startOpsLogListener() {
    const list = document.getElementById("ops-log-list");
    const table = document.getElementById("ops-log-table");
    if (!list && !table) return;
    db.collection("opsLogs").orderBy("createdAt", "desc").limit(50).onSnapshot(snapshot => {
        const rows = [];
        snapshot.forEach(doc => rows.push({ id: doc.id, ...doc.data() }));
        if (list) list.innerHTML = rows.slice(0, 8).map(row => `<p class="text-xs text-slate-400">${escapeHtml(row.action)} / ${escapeHtml(row.actorName || "")}</p>`).join("") || `<p class="text-xs text-slate-500">ログなし</p>`;
        if (table) table.innerHTML = rows.map(row => `<tr class="border-t border-slate-800"><td class="py-2 pr-3">${escapeHtml(row.action)}</td><td class="py-2 pr-3">${escapeHtml(row.actorName || "")}</td><td class="py-2">${row.createdAt?.toDate ? row.createdAt.toDate().toLocaleString() : ""}</td></tr>`).join("") || `<tr><td class="py-2 text-slate-500" colspan="3">ログなし</td></tr>`;
    }, console.error);
}

function loadInviteLogsForOps() {
    const table = document.getElementById("ops-invite-table");
    if (!table || !canUseOpsPortal()) return;
    db.collection("roleInvites").limit(50).get().then(snapshot => {
        const rows = [];
        snapshot.forEach(doc => rows.push({ id: doc.id, ...doc.data() }));
        table.innerHTML = rows.map(row => `<tr class="border-t border-slate-800"><td class="py-2 pr-3">${maskCode(row.id)}</td><td class="py-2 pr-3">${escapeHtml(ROLE_LABELS[row.role] || row.role || "")}</td><td class="py-2 pr-3">${row.used ? "使用済" : "未使用"}</td><td class="py-2">${escapeHtml(row.allowedEmail ? row.allowedEmail.replace(/^(.{2}).*(@.*)$/, "$1***$2") : "")}</td></tr>`).join("") || `<tr><td class="py-2 text-slate-500" colspan="4">ログなし</td></tr>`;
    }).catch(console.error);
}

function loadSurveyLogsForOps() {
    const list = document.getElementById("ops-survey-list");
    const table = document.getElementById("ops-survey-table");
    if ((!list && !table) || !canUseOpsPortal()) return;
    db.collection("registrationSurveys").limit(50).get().then(snapshot => {
        const rows = [];
        snapshot.forEach(doc => rows.push({ id: doc.id, ...doc.data() }));
        if (list) {
            list.innerHTML = rows.slice(0, 8).map(row => `
                <article class="rounded-lg bg-slate-900 border border-slate-800 p-3">
                    <p class="text-xs text-slate-300">${escapeHtml(row.email || row.id || "unknown")}</p>
                    <p class="text-xs text-slate-400 mt-1">${escapeHtml(row.discovery || "未回答")}</p>
                </article>
            `).join("") || `<p class="text-xs text-slate-500">アンケート回答はありません。</p>`;
        }
        if (table) {
            table.innerHTML = rows.map(row => `
                <tr class="border-t border-slate-800">
                    <td class="py-2 pr-3">${escapeHtml(row.email || row.id || "")}</td>
                    <td class="py-2 pr-3">${escapeHtml([row.birthYear, row.birthMonth, row.birthDay].filter(Boolean).join("/"))}</td>
                    <td class="py-2 pr-3">${escapeHtml(row.gender || "")}</td>
                    <td class="py-2 pr-3">${escapeHtml(row.device === "other" ? row.deviceOther : row.device || "")}</td>
                    <td class="py-2">${escapeHtml(row.discovery || "")}</td>
                </tr>
            `).join("") || `<tr><td class="py-2 text-slate-500" colspan="5">ログなし</td></tr>`;
        }
    }).catch(console.error);
}

function switchOpsTab(tabId) {
    document.querySelectorAll(".ops-tab-panel").forEach(panel => panel.classList.add("hidden"));
    const panel = document.getElementById(`ops-tab-${tabId}`);
    if (panel) panel.classList.remove("hidden");
    document.querySelectorAll(".ops-tab-btn").forEach(button => {
        const active = button.dataset.opsTab === tabId;
        button.className = active
            ? "ops-tab-btn rounded-lg bg-slate-700 px-3 py-2 text-xs font-bold text-white shadow-sm ring-1 ring-slate-500"
            : "ops-tab-btn rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-bold text-slate-400 hover:border-slate-600 hover:text-slate-200";
    });
}

function renderLiveOpsLog(steps = []) {
    const box = document.getElementById("ops-live-log");
    if (!box) return;
    box.classList.remove("hidden");
    box.innerHTML = `
        <p class="mb-2 font-bold text-slate-100">処理ログ</p>
        <ol class="space-y-1">
            ${steps.map(step => {
                const color = step.status === "ok" ? "text-emerald-300" : step.status === "error" ? "text-red-300" : "text-amber-300";
                const mark = step.status === "ok" ? "✓" : step.status === "error" ? "!" : "…";
                return `<li class="${color}"><span class="font-mono">${mark}</span> ${escapeHtml(step.label)}${step.detail ? ` <span class="text-slate-500">- ${escapeHtml(step.detail)}</span>` : ""}</li>`;
            }).join("")}
        </ol>
    `;
}

async function createInviteCodeFromOps() {
    if (!auth.currentUser || !canUseOpsPortal()) return alert("操作権限がありません。");
    const steps = [];
    const pushStep = (label, status = "pending", detail = "") => {
        steps.push({ label, status, detail });
        renderLiveOpsLog(steps);
    };
    const markLast = (status, detail = "") => {
        steps[steps.length - 1].status = status;
        steps[steps.length - 1].detail = detail;
        renderLiveOpsLog(steps);
    };

    const code = formatInviteCode(readCodeParts("ops-invite-code"));
    const role = document.getElementById("ops-invite-role")?.value || "";
    const email = document.getElementById("ops-invite-email")?.value.trim() || "";
    try {
        pushStep("入力値を確認");
        if (normalizeInviteCode(code).length !== 12) throw new Error("会員IDは4桁-4桁-4桁で入力してください。");
        if (!email || !email.includes("@")) throw new Error("Gmailアドレスを入力してください。");
        if (!["fan", "aureole", "admin"].includes(role)) throw new Error("権限を選択してください。");
        markLast("ok");

        pushStep("Firestore roleInvites へ保存");
        await db.collection("roleInvites").doc(code).set({
            role,
            allowedEmail: email,
            used: false,
            issuedBy: auth.currentUser.uid,
            issuedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        markLast("ok", maskCode(code));

        pushStep("送信用文面を作成");
        const text = `会員IDが発行されました。\n登録されたGmailアドレス：　${email}\n会員：${ROLE_LABELS[role]}\n会員ID：${code}\n\n※会員IDは発行順ではない、ランダムな値です。なお再発行にはお時間をいただきますので、必ずどこかに記録・メモを行ってください。`;
        const output = document.getElementById("ops-invite-copy-text");
        if (output) output.value = text;
        markLast("ok");

        pushStep("操作ログを記録");
        await logOps("invite.create", { role, allowedEmail: email, codeMasked: maskCode(code) });
        markLast("ok");
        writeCodeParts("ops-invite-code", "");
    } catch (error) {
        markLast("error", error.message);
        alert(error.message);
    }
}

function startOpsLogListener() {
    const list = document.getElementById("ops-log-list");
    const table = document.getElementById("ops-log-table");
    if (!list && !table) return;
    db.collection("opsLogs").orderBy("createdAt", "desc").limit(50).onSnapshot(snapshot => {
        const rows = [];
        snapshot.forEach(doc => rows.push({ id: doc.id, ...doc.data() }));
        if (list) {
            list.innerHTML = rows.slice(0, 8).map(row => `
                <div class="flex items-center justify-between gap-2 rounded border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-slate-400">
                    <span>${escapeHtml(row.action)} / ${escapeHtml(row.actorName || "")}</span>
                    <button onclick="deleteOpsLog('${row.id}')" class="text-red-300 hover:text-red-200">削除</button>
                </div>
            `).join("") || `<p class="text-xs text-slate-500">ログなし</p>`;
        }
        if (table) {
            table.innerHTML = rows.map(row => `
                <tr class="border-t border-slate-800">
                    <td class="py-2 pr-3">${escapeHtml(row.action)}</td>
                    <td class="py-2 pr-3">${escapeHtml(row.actorName || "")}</td>
                    <td class="py-2 pr-3">${row.createdAt?.toDate ? row.createdAt.toDate().toLocaleString() : ""}</td>
                    <td class="py-2"><button onclick="deleteOpsLog('${row.id}')" class="rounded border border-red-900/60 px-2 py-1 text-[11px] text-red-300 hover:bg-red-950">削除</button></td>
                </tr>
            `).join("") || `<tr><td class="py-2 text-slate-500" colspan="4">ログなし</td></tr>`;
        }
    }, console.error);
}

async function deleteOpsLog(logId) {
    if (!auth.currentUser || currentRole !== "admin") return alert("ログ削除は管理者のみ実行できます。");
    if (!confirm("この実行ログを削除します。よろしいですか？")) return;
    await db.collection("opsLogs").doc(logId).delete()
        .then(() => alert("ログを削除しました。"))
        .catch(error => alert(`ログ削除に失敗しました: ${error.message}`));
}

async function loadGameScriptDraft() {
    if (!auth.currentUser || !canUseOpsPortal()) return alert("操作権限がありません。");
    const editor = document.getElementById("ops-game-code-editor");
    const log = document.getElementById("ops-game-debug-log");
    if (!editor) return;
    try {
        const doc = await db.collection("gameScripts").doc("star-runner").get();
        editor.value = doc.exists ? (doc.data().codeDraft || "") : (window.StarRunner?.sourceHint || "");
        if (log) log.textContent = "下書きを読み込みました。";
    } catch (error) {
        if (log) log.textContent = `読み込み失敗: ${error.message}`;
    }
}

async function saveGameScriptDraft() {
    if (!auth.currentUser || !canUseOpsPortal()) return alert("操作権限がありません。");
    const editor = document.getElementById("ops-game-code-editor");
    const log = document.getElementById("ops-game-debug-log");
    const codeDraft = editor?.value || "";
    try {
        await db.collection("gameScripts").doc("star-runner").set({
            codeDraft,
            updatedBy: auth.currentUser.uid,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        await logOps("gameScript.draft.save", { game: "star-runner", bytes: codeDraft.length });
        if (log) log.textContent = "下書きを保存しました。";
    } catch (error) {
        if (log) log.textContent = `保存失敗: ${error.message}`;
        alert(error.message);
    }
}

function renderOpsTables() {
    const announcementTable = document.getElementById("ops-announcement-table");
    if (announcementTable) {
        announcementTable.innerHTML = cachedAnnouncements.map(item => `
            <tr class="border-t border-slate-800">
                <td class="py-2 pr-3">${escapeHtml(item.title || "")}</td>
                <td class="py-2 pr-3">${item.publishAtMillis ? new Date(item.publishAtMillis).toLocaleString() : "即時"}</td>
                <td class="py-2 pr-3">${item.url ? "あり" : "なし"}</td>
                <td class="py-2"><button onclick="deleteAnnouncementFromOps('${item.id}')" class="rounded border border-red-900/60 px-2 py-1 text-[11px] text-red-300 hover:bg-red-950">削除</button></td>
            </tr>
        `).join("") || `<tr><td class="py-2 text-slate-500" colspan="4">ログなし</td></tr>`;
    }
    const eventTable = document.getElementById("ops-event-table");
    if (eventTable) {
        eventTable.innerHTML = cachedEvents.map(item => `
            <tr class="border-t border-slate-800">
                <td class="py-2 pr-3">${escapeHtml(item.title || "")}</td>
                <td class="py-2 pr-3">${escapeHtml(item.type || "")}</td>
                <td class="py-2 pr-3">${escapeHtml(item.status || "")}</td>
                <td class="py-2"><button onclick="deleteEventFromOps('${item.id}')" class="rounded border border-red-900/60 px-2 py-1 text-[11px] text-red-300 hover:bg-red-950">削除</button></td>
            </tr>
        `).join("") || `<tr><td class="py-2 text-slate-500" colspan="4">ログなし</td></tr>`;
    }
}

async function deleteAnnouncementFromOps(id) {
    if (!auth.currentUser || !canUseOpsPortal()) return alert("操作権限がありません。");
    if (!confirm("このお知らせを削除します。よろしいですか？")) return;
    await db.collection("announcements").doc(id).delete()
        .then(() => logOps("announcement.delete", { id }))
        .catch(error => alert(error.message));
}

async function deleteEventFromOps(id) {
    if (!auth.currentUser || !canUseOpsPortal()) return alert("操作権限がありません。");
    if (!confirm("このイベントを削除します。よろしいですか？")) return;
    await db.collection("events").doc(id).delete()
        .then(() => logOps("event.delete", { id }))
        .catch(error => alert(error.message));
}

function loadInviteLogsForOps() {
    const table = document.getElementById("ops-invite-table");
    if (!table || !canUseOpsPortal()) return;
    db.collection("roleInvites").limit(50).get().then(snapshot => {
        const rows = [];
        snapshot.forEach(doc => rows.push({ id: doc.id, ...doc.data() }));
        table.innerHTML = rows.map(row => `
            <tr class="border-t border-slate-800">
                <td class="py-2 pr-3">${maskCode(row.id)}</td>
                <td class="py-2 pr-3">${escapeHtml(ROLE_LABELS[row.role] || row.role || "")}</td>
                <td class="py-2 pr-3">${row.used ? "使用済" : "未使用"}</td>
                <td class="py-2 pr-3">${escapeHtml(row.allowedEmail ? row.allowedEmail.replace(/^(.{2}).*(@.*)$/, "$1***$2") : "")}</td>
                <td class="py-2"><button onclick="deleteInviteFromOps('${row.id}')" class="rounded border border-red-900/60 px-2 py-1 text-[11px] text-red-300 hover:bg-red-950">削除</button></td>
            </tr>
        `).join("") || `<tr><td class="py-2 text-slate-500" colspan="5">ログなし</td></tr>`;
    }).catch(console.error);
}

async function deleteInviteFromOps(code) {
    if (!auth.currentUser || !canUseOpsPortal()) return alert("操作権限がありません。");
    if (!confirm("この会員ID発行レコードを削除します。よろしいですか？")) return;
    await db.collection("roleInvites").doc(code).delete()
        .then(async () => {
            await logOps("invite.delete", { codeMasked: maskCode(code) });
            loadInviteLogsForOps();
        })
        .catch(error => alert(error.message));
}

const sidebar = document.getElementById("sidebar");
const overlay = document.getElementById("overlay");
const menuBtn = document.getElementById("menu-btn");
const closeBtn = document.getElementById("close-btn");

function openSidebar() {
    if (!sidebar || !overlay) return;
    sidebar.classList.remove("-translate-x-full");
    overlay.classList.remove("opacity-0", "pointer-events-none");
}

function closeSidebar() {
    if (!sidebar || !overlay) return;
    sidebar.classList.add("-translate-x-full");
    overlay.classList.add("opacity-0", "pointer-events-none");
}

if (menuBtn) menuBtn.addEventListener("click", openSidebar);
if (closeBtn) closeBtn.addEventListener("click", closeSidebar);
if (overlay) overlay.addEventListener("click", closeSidebar);

document.addEventListener("DOMContentLoaded", () => {
    setupCodePartInputs(".member-id-part");
    setupCodePartInputs(".settings-member-id-part");
    setupCodePartInputs(".ops-invite-code-part");
    const surveyToggle = document.getElementById("survey-opt-in");
    if (surveyToggle) surveyToggle.addEventListener("change", () => document.getElementById("survey-fields").classList.toggle("hidden", !surveyToggle.checked));
    ["survey-device", "standalone-survey-device"].forEach(id => {
        const select = document.getElementById(id);
        const other = document.getElementById(`${id}-other`);
        if (select && other) select.addEventListener("change", () => other.classList.toggle("hidden", select.value !== "other"));
    });
    const postText = document.getElementById("post-text");
    const postRemaining = document.getElementById("post-remaining");
    if (postText && postRemaining) {
        const updateRemaining = () => { postRemaining.textContent = String(200 - postText.value.length); };
        postText.addEventListener("input", updateRemaining);
        updateRemaining();
    }
    document.addEventListener("keydown", event => {
        if (event.code === "Space" && document.activeElement?.tagName !== "TEXTAREA" && document.activeElement?.tagName !== "INPUT") {
            runnerJump();
        }
    });
    const runnerCanvas = document.getElementById("runner-game");
    if (runnerCanvas) runnerCanvas.addEventListener("pointerdown", runnerJump);
    const iconFile = document.getElementById("member-icon-file");
    if (iconFile) iconFile.addEventListener("change", event => handleIconFile(event.target.files[0], "member-icon-file").catch(error => alert(error.message)));
    const settingsIconFile = document.getElementById("settings-icon-file");
    if (settingsIconFile) settingsIconFile.addEventListener("change", event => handleIconFile(event.target.files[0], "settings-icon-file").catch(error => alert(error.message)));
    ["icon-zoom", "icon-offset-x", "icon-offset-y"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener("input", () => {
            iconCropState.zoom = Number(document.getElementById("icon-zoom").value);
            iconCropState.x = Number(document.getElementById("icon-offset-x").value);
            iconCropState.y = Number(document.getElementById("icon-offset-y").value);
            updateIconPreview();
        });
    });
    document.querySelectorAll(".ops-tab-btn").forEach(button => button.addEventListener("click", () => switchOpsTab(button.dataset.opsTab)));
    if (document.getElementById("ops-panel")) switchOpsTab("announcements");
    startTimelineListener();
    startAnnouncementListener();
    loadHomeYouTubeCard();
    startXFeedListener();
    startEventsListener();
    startOpsLogListener();
    renderSecretButtons();
});

Object.assign(window, {
    openLoginChoice,
    closeLoginChoice,
    beginLoginFlow,
    loginWithGoogle,
    logout,
    switchWindow,
    unlockSettingsPanel,
    clearSettingsMemberId,
    saveMemberRegistration,
    saveUserSettings,
    unlockSecret,
    discoverKeyword,
    openPasswordModal,
    addPost,
    deletePost,
    requestDelete,
    toggleReplies,
    closeReplies,
    addReply,
    switchOpsTab,
    addAnnouncementFromOps,
    addEventFromOps,
    createInviteCodeFromOps,
    copyInviteText,
    loadInviteLogsForOps,
    loadSurveyLogsForOps,
    submitStandaloneSurvey,
    likePost,
    likeReply,
    requestDeleteReply,
    deleteReply,
    deleteOpsLog,
    deleteAnnouncementFromOps,
    deleteEventFromOps,
    deleteInviteFromOps,
    loadGameScriptDraft,
    saveGameScriptDraft,
    startRunnerGame,
    runnerJump,
    opsRunnerDebug
});
