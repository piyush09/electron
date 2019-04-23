// import devtools from '@vue/devtools'
import Vue from 'vue';
import VueRouter from 'vue-router';
import BootstrapVue from 'bootstrap-vue';
import Vs from 'd3-vs';
import Axios from 'axios';
import VueAxios from 'vue-axios';
import VueProgress from 'vue-progress-path';
import VueSidebarMenu from 'vue-sidebar-menu';
import electron from 'electron';
import deepEqual from 'deep-equal';

import App from './App.vue';
import router from './router';
import store from './store';
import i18n from './i18n';
import Dashboard from './plugins/dashboard';
import { baseURL } from './apiConfig';
import {
  UPDATE_TORRENT,
  UNARCHIVE_OK,
  UNARCHIVE_FAIL,
  TORRENT_DOWNLOADED,
  UPDATE_TORRENT_INFOHASH,
  UPDATE_TORRENT_PROGRESS,
  STOP_TORRENTS,
} from './store/mutation-types';
import './registerServiceWorker';

import './assets/scss/main.scss';

import { State } from './state';
import {
  STATE_SAVE,
  STATE_SAVE_IMMEDIATE,
  UNCAUGHT_ERROR,
  UNZIP_GAME_OK,
  UNZIP_GAME_FAIL, AUTHORIZED, UNAUTHORIZED,
} from './dispatch-types';

import { UNARCHIVE_GAME } from './store/actions-types';


const IS_DEV = process.env.NODE_ENV === 'development';

Vue.use(VueProgress);

Vue.router = router;
Vue.use(VueAxios, Axios);

Vue.axios.defaults.baseURL = baseURL;

// const token = localStorage.getItem('token');
//
// if (token) {
//   Vue.prototype.$http.defaults.headers.common['Authorization'] = token;
// }

Vue.use(VueSidebarMenu);
Vue.use(BootstrapVue);
Vue.use(Dashboard);
Vue.use(VueRouter);
Vue.use(Vs);

// let store = require("electron").remote.getGlobal("vuexStore");

const app = new Vue({
  router,
  store,
  i18n,
  mounted() {
    // Prevent blank screen in Electron builds
    this.$router.push({ name: 'home' });

    if (IS_DEV) {
      // require('devtron').install();
    }
  },
  render: h => h(App),
}).$mount('#app');
window.app = app;

if (IS_DEV) {
  window.require('devtron').install();
}

const { ipcRenderer } = electron;
// Save is restored on app load and saved before quitting
let state;

function getSavedGlobalState() {
  return {};
}

function getSavedUserState() {
  // Hack to avoid reactivity. Otherwise undefined is saved
  const vueTorrents = JSON.parse(JSON.stringify(app.$store.state.torrents));
  const result = {
    ...state,
    vue: {
      route: {
        name: app.$route.name,
        params: app.$route.params,
      },
    },
    torrents: vueTorrents.map(t => ({
      gameId: t.gameId,
      downloaded: t.downloaded,
      infoHash: t.infoHash,
      path: t.path,
      state: t.state,
      torrentFileName: t.torrentFileName,
      torrentURL: t.torrentURL,
    })),
  };
  console.log('saved state=', result);
  console.log('vue state', app.$store.state);
  return result;
}

// function getGlobalSavedState() {
//   return {
//     ...state,
//     vue: {
//       route: {
//         name: app.$route.name,
//         params: app.$route.params,
//       },
//     },
//     auth: {
//       token: app.$store.state.auth.token
//     }
//   };
// }
//
// function getUserSavedState() {
//   const vueTorrents = JSON.parse(JSON.stringify(app.$store.state.torrents));
//
//   const result = {
//     ...state,
//     torrents: vueTorrents.map(t => ({
//       gameId: t.gameId,
//       downloaded: t.downloaded,
//       infoHash: t.infoHash,
//       path: t.path,
//       state: t.state,
//       torrentFileName: t.torrentFileName,
//       torrentURL: t.torrentURL,
//     })),
//   };
//
//   console.log('saved state=', result);
//   console.log('vue state', app.$store.state);
//
//   return result;
// }

const dispatchHandlers = {
  [STATE_SAVE]: () => {
    State.save(getSavedGlobalState());
    const { username } = app.$store.state.auth.user;
    if (username !== void 0) {
      State.saveUser(username, getSavedUserState());
    }
  },
  [STATE_SAVE_IMMEDIATE]: () => {
    State.saveImmediate(getSavedGlobalState())
    const { username } = app.$store.state.auth.user;
    if (username !== void 0) {
      State.saveUserImmediate(username, getSavedUserState());
    }
  },
  error: (err) => {
    console.error(err.stack || err);
  },
  [UNCAUGHT_ERROR]: (err) => {
    console.error('Uncaught error', err.stack || err);
  },
};

function dispatch(action, ...args) {
  const handler = dispatchHandlers[action];
  if (handler) handler(...args);
  else console.error(`Missing dispatch handler: ${action}`);
}

function setupIpc() {
  ipcRenderer.on('wt-infohash', (e, torrentKey, infoHash) => {
    const { getters, dispatch } = app.$store;
    const { findTorrentByInfoHash } = getters;
    const existingTorrent = findTorrentByInfoHash(infoHash);
    if (existingTorrent && existingTorrent.torrentKey !== torrentKey) {
      ipcRenderer.send('wt-stop-torrenting', infoHash);
      return dispatch('error', 'Cannot add duplicate torrent');
    }
    dispatch({
      type: UPDATE_TORRENT_INFOHASH,
      payload: {
        torrentKey,
        infoHash,
      },
    });
  });

  ipcRenderer.on('wt-metadata', (e, torrentKey, torrentInfo) => {
    const { getters, dispatch } = app.$store;
    const { findTorrentByKey } = getters;
    const torrent = findTorrentByKey(torrentKey);
    if (torrent) {
      dispatch({
        type: UPDATE_TORRENT,
        payload: {
          torrentKey,
          state: 'downloading',
          path: torrentInfo.path,
        },
      });

      // Save the .torrent file, if it hasn't been saved already
      if (!torrent.torrentFileName) {
        ipcRenderer.send('wt-save-torrent-file', torrentKey);
      }
    }
  });

  ipcRenderer.on('wt-file-saved', (e, torrentKey, torrentFileName) => {
    console.log('torrent file saved %s: %s', torrentKey, torrentFileName);

    const { getters } = app.$store;
    const { findTorrentByKey } = getters;
    const torrent = findTorrentByKey(torrentKey);
    if (torrent) {
      app.$store.dispatch({
        type: UPDATE_TORRENT,
        payload: {
          torrentKey,
          torrentFileName,
        },
      });
      dispatch(STATE_SAVE);
    }
  });

  ipcRenderer.on('wt-progress', (e, progressInfo) => {
    progressInfo.torrents.forEach((p) => {
      const { torrentKey } = p;
      const { getters, dispatch } = app.$store;
      const { findTorrentByKey } = getters;
      const torrent = findTorrentByKey(torrentKey);
      // Skip progress update if torrent is not ready
      if (torrent && !deepEqual(torrent.progress, p) && p.ready) {
        if (torrent.downloaded && p.progress !== 1) {
          // Reset done
          dispatch({
            type: UPDATE_TORRENT,
            payload: {
              torrentKey,
              downloaded: false,
            },
          });
        }
        const patch = {
          torrentKey,
          progress: p,
        };
        dispatch({
          type: UPDATE_TORRENT_PROGRESS,
          payload: patch,
        });
      }
    });
  });

  ipcRenderer.on('wt-done', (e, torrentKey, torrentInfo) => {
    console.log('wt-done');
    const { getters, dispatch } = app.$store;
    const { findTorrentByKey } = getters;
    const { files } = torrentInfo;
    const torrent = findTorrentByKey(torrentKey);
    // console.log('wt-done', torrentKey, torrent);
    if (torrent) {
      console.log('wt-done START SEEDING');
      dispatch({
        type: UPDATE_TORRENT,
        payload: {
          torrentKey,
          downloaded: true,
          state: 'seeding',
          files,
        },
      });
    }

    if (torrentInfo.bytesReceived > 0) {
      console.log('wt-done TORRENT_DOWNLOADED');
      dispatch({
        type: TORRENT_DOWNLOADED,
        payload: {
          torrentKey,
        },
      });

      // Autorun unzip
      dispatch(UNARCHIVE_GAME, {
        gameId: torrent.gameId,
      });
      // ipcRenderer.send('downloadFinished', getTorrentPath(torrentSummary))
    }
  });

  ipcRenderer.on(UNZIP_GAME_OK, (e, gameId) => {
    console.log('UNARCHIVE_OK', gameId);
    const { dispatch } = app.$store;
    dispatch({
      type: UNARCHIVE_OK,
      payload: { gameId },
    });
  });
  ipcRenderer.on(UNZIP_GAME_FAIL, (e, gameId) => {
    console.log('UNARCHIVE_FAIL', gameId);
    const { dispatch } = app.$store;
    dispatch({
      type: UNARCHIVE_FAIL,
      payload: { gameId },
    });
  });

  ipcRenderer.on('wt-warning', (e, torrentKey, message) => {
    console.warn(`torrentKey=${torrentKey}, msg: ${message}`);
  });

  ipcRenderer.on('wt-error', (e, torrentKey, message) => {
    console.error('wt-error', torrentKey, message);
    // const torrent = store.getters.findTorrentByKey(torrentKey);
    // const { state } = torrent;
    const { dispatch } = app.$store;
    dispatch({
      type: UPDATE_TORRENT,
      payload: {
        torrentKey,
        state: 'error',
        errorMessage: message,
      },
    });
  });

  ipcRenderer.on('dispatch', (e, ...args) => dispatch(...args));
  State.on('stateSaved', () => ipcRenderer.send('stateSaved'));
}

setupIpc();

// Remove all torrents to reset webtorrent state (fixes hot-reload issues because of desynchronization)
// FIXME: sometimes it finishes after load state
console.log('SHOULD (DONE) wt-reset');
// ipcRenderer.send('wt-reset');

// ipcRenderer.once(AUTHORIZED, () => {
//   ipcRenderer.send('wt-reset');
// });

function startSeeding() {
  ipcRenderer.send('wt-reset');

  ipcRenderer.once(UNAUTHORIZED, () => {
    console.log(UNAUTHORIZED, store);

    store.dispatch(STOP_TORRENTS);

    ipcRenderer.once(AUTHORIZED, startSeeding);
  });
}

ipcRenderer.once(AUTHORIZED, startSeeding);

/* ipcRenderer.once('wt-reset-ok', () => {
  console.log('wt-reset-ok');
  State.load().then((s) => {
    restoreStoreFromSavedUserState(app.$store, s);
    // setInterval(() => { State.saveImmediate(getSavedState()) }, 5000);
  });
}); */
