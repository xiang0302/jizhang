/* ==========================================================================
   cloud.js — Firebase Google 登录与多用户自动云同步引擎 (手机端优先跳转登录)
   ========================================================================== */
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithRedirect,
  signInWithPopup,
  getRedirectResult,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAVmYu103CWL6xqDEAUrLvCRuiD75rMJAI",
  authDomain: "zhijian-ledger.firebaseapp.com",
  projectId: "zhijian-ledger",
  storageBucket: "zhijian-ledger.firebasestorage.app",
  messagingSenderId: "165693740515",
  appId: "1:165693740515:web:bef0e3017cd52977e3fcd6"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

let currentCloudUser = null;
let unsubscribeSnapshot = null;
let cloudPushTimer = null;
let isApplyingRemoteUpdate = false;
let lastKnownCloudJson = '';

function updateCloudUI(state, text, user = null) {
  const dot = document.getElementById('cloudSyncDot');
  const label = document.getElementById('cloudSyncLabel');
  const nameEl = document.getElementById('cloudUserName');
  const avatarImg = document.getElementById('cloudUserAvatar');
  const avatarFallback = document.getElementById('cloudAvatarFallback');
  const signInBtn = document.getElementById('btnGoogleSignIn');
  const signOutBtn = document.getElementById('btnGoogleSignOut');

  if (dot) dot.className = 'sync-dot ' + (state || '');
  if (label) label.textContent = text;

  if (user) {
    if (nameEl) nameEl.textContent = user.displayName || user.email || '已登录用户';
    if (user.photoURL && avatarImg) {
      avatarImg.src = user.photoURL;
      avatarImg.classList.remove('hidden');
      if (avatarFallback) avatarFallback.classList.add('hidden');
    } else {
      if (avatarImg) avatarImg.classList.add('hidden');
      if (avatarFallback) avatarFallback.classList.remove('hidden');
    }
    if (signInBtn) signInBtn.classList.add('hidden');
    if (signOutBtn) signOutBtn.classList.remove('hidden');
  } else {
    if (nameEl) nameEl.textContent = '本地离线记账模式';
    if (avatarImg) avatarImg.classList.add('hidden');
    if (avatarFallback) avatarFallback.classList.remove('hidden');
    if (signInBtn) {
      signInBtn.classList.remove('hidden');
      signInBtn.disabled = false;
      signInBtn.style.opacity = '1';
    }
    if (signOutBtn) signOutBtn.classList.add('hidden');
  }
}

function hasLocalData() {
  return (
    (appState.accounts && appState.accounts.length > 0) ||
    (appState.categories && appState.categories.length > 0) ||
    (appState.transactions && appState.transactions.length > 0) ||
    (appState.transfers && appState.transfers.length > 0)
  );
}

async function pushStateToCloud(immediate = false) {
  if (!currentCloudUser || isApplyingRemoteUpdate) return;
  const userDocRef = doc(db, 'users', currentCloudUser.uid, 'ledger', 'main');
  const payload = {
    accounts: appState.accounts || [],
    categories: appState.categories || [],
    transactions: appState.transactions || [],
    transfers: appState.transfers || [],
    updatedAt: Date.now()
  };
  const serialized = JSON.stringify({
    accounts: payload.accounts,
    categories: payload.categories,
    transactions: payload.transactions,
    transfers: payload.transfers
  });
  if (serialized === lastKnownCloudJson && !immediate) return;

  updateCloudUI('syncing', '正在同步至云端...', currentCloudUser);
  try {
    await setDoc(userDocRef, payload, { merge: true });
    lastKnownCloudJson = serialized;
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    updateCloudUI('synced', `云端已同步 (${hh}:${mm})`, currentCloudUser);
  } catch (err) {
    updateCloudUI('error', '云同步异常: ' + (err.code || err.message), currentCloudUser);
  }
}

window.scheduleCloudPush = function () {
  if (!currentCloudUser || isApplyingRemoteUpdate) return;
  updateCloudUI('syncing', '正在保存更改...', currentCloudUser);
  clearTimeout(cloudPushTimer);
  cloudPushTimer = setTimeout(() => {
    pushStateToCloud(false);
  }, 600);
};

async function setupUserCloudSync(user) {
  currentCloudUser = user;
  updateCloudUI('syncing', '正在连接云端账本...', user);

  if (unsubscribeSnapshot) {
    unsubscribeSnapshot();
    unsubscribeSnapshot = null;
  }

  const userDocRef = doc(db, 'users', user.uid, 'ledger', 'main');

  try {
    const snap = await getDoc(userDocRef);
    if (!snap.exists()) {
      await pushStateToCloud(true);
      if (hasLocalData()) {
        showToast('已将本地现有账本自动迁移至云端！');
      }
    } else {
      const data = snap.data();
      const remoteState = {
        accounts: Array.isArray(data.accounts) ? data.accounts : [],
        categories: Array.isArray(data.categories) ? data.categories : [],
        transactions: Array.isArray(data.transactions) ? data.transactions : [],
        transfers: Array.isArray(data.transfers) ? data.transfers : []
      };
      const remoteHasData =
        remoteState.accounts.length > 0 ||
        remoteState.categories.length > 0 ||
        remoteState.transactions.length > 0 ||
        remoteState.transfers.length > 0;

      if (!remoteHasData && hasLocalData()) {
        await pushStateToCloud(true);
      } else {
        isApplyingRemoteUpdate = true;
        appState = remoteState;
        lastKnownCloudJson = JSON.stringify(remoteState);
        saveState(true);
        renderAll();
        isApplyingRemoteUpdate = false;
        updateCloudUI('synced', '已与云端保持同步', user);
      }
    }
  } catch (err) {
    updateCloudUI('error', '读取云端失败: ' + (err.code || err.message), user);
  }

  unsubscribeSnapshot = onSnapshot(userDocRef, (docSnap) => {
    if (!docSnap.exists() || docSnap.metadata.hasPendingWrites) return;
    const data = docSnap.data();
    const incoming = {
      accounts: Array.isArray(data.accounts) ? data.accounts : [],
      categories: Array.isArray(data.categories) ? data.categories : [],
      transactions: Array.isArray(data.transactions) ? data.transactions : [],
      transfers: Array.isArray(data.transfers) ? data.transfers : []
    };
    const incomingJson = JSON.stringify(incoming);
    if (incomingJson === lastKnownCloudJson) return;

    isApplyingRemoteUpdate = true;
    appState = incoming;
    lastKnownCloudJson = incomingJson;
    saveState(true);
    renderAll();
    isApplyingRemoteUpdate = false;
    updateCloudUI('synced', '已接收云端最新账目', user);
  });
}

window.handleGoogleSignIn = async function () {
  const btn = document.getElementById('btnGoogleSignIn');
  if (btn) {
    btn.disabled = true;
    btn.style.opacity = '0.6';
  }
  updateCloudUI('syncing', '正在跳转 Google 登录页...', null);
  showToast('正在跳转至 Google 账号选择页...');

  try {
    await signInWithRedirect(auth, provider);
  } catch (err) {
    try {
      await signInWithPopup(auth, provider);
    } catch (popErr) {
      updateCloudUI('', '登录失败: ' + (popErr.code || popErr.message), null);
      showToast('登录失败: ' + (popErr.code || popErr.message));
    }
  }
};

window.handleGoogleSignOut = function () {
  showConfirmModal(
    '退出 Google 账号',
    '退出后将切换回本地离线模式（云端数据已安全保存，下次登录随时恢复）。确定要退出吗？',
    async function () {
      if (unsubscribeSnapshot) {
        unsubscribeSnapshot();
        unsubscribeSnapshot = null;
      }
      await signOut(auth);
      currentCloudUser = null;
      lastKnownCloudJson = '';
      updateCloudUI('', '已退出登录，当前为本地模式', null);
      showToast('已安全退出 Google 账号');
    }
  );
};

window.initFirebaseCloudSync = function () {
  getRedirectResult(auth)
    .then((result) => {
      if (result && result.user) {
        showToast('Google 登录成功！');
      }
    })
    .catch((err) => {
      if (err && err.code) {
        updateCloudUI('error', '授权返回异常: ' + err.code, null);
        showToast('授权异常: ' + err.code);
      }
    });

  onAuthStateChanged(auth, (user) => {
    if (user) {
      setupUserCloudSync(user);
    } else {
      currentCloudUser = null;
      if (unsubscribeSnapshot) {
        unsubscribeSnapshot();
        unsubscribeSnapshot = null;
      }
      updateCloudUI('', '登录 Google 账号即可开启跨设备云同步', null);
    }
  });
};

window.initFirebaseCloudSync();
