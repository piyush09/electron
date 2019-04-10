// import devtools from '@vue/devtools'
import Vue from 'vue';
import VueRouter from 'vue-router';
import BootstrapVue from 'bootstrap-vue';
import Vs from 'd3-vs';
import axios from 'axios';
import VueAxios from 'vue-axios';
import VueProgress from 'vue-progress-path';

import App from './App.vue';
import router from './router';
import store from './store';
import i18n from './i18n';
import Dashboard from './plugins/dashboard';
import { baseURL, authConfig } from './apiConfig';
import VueSidebarMenu from 'vue-sidebar-menu'
import { UPDATE_TORRENT, ADD_TORRENT, NEXT_TORRENT_KEY_USED, UNARCHIVE_OK, UNARCHIVE_FAIL, TORRENT_DOWNLOADED, UPDATE_TORRENT_INFOHASH, UPDATE_TORRENT_PROGRESS } from './store/mutation-types';
import './registerServiceWorker';
const IS_DEV = process.env.NODE_ENV === 'development';

Vue.use(VueProgress);

Vue.router = router;

Vue.use(VueAxios, axios);

Vue.axios.defaults.baseURL = baseURL;

Vue.use(require('@websanova/vue-auth'), {
  auth: require('@websanova/vue-auth/drivers/auth/bearer.js'),
  http: require('@websanova/vue-auth/drivers/http/axios.1.x.js'),
  router: require('@websanova/vue-auth/drivers/router/vue-router.2.x.js'),
  ...authConfig});

Vue.use(VueSidebarMenu);

import './assets/scss/main.scss';

/* import test from './fs';
test.test(); */

Vue.use(BootstrapVue);
Vue.use(Dashboard);
Vue.use(VueRouter);

Vue.use(Vs);

const app = new Vue({
  router,
  store,
  i18n,
  mounted() {
    // Prevent blank screen in Electron builds
    this.$router.push({name: 'home'});

    if (IS_DEV) {
      // require('devtron').install();
    }
  },
  render: h => h(App),
}).$mount('#app');
window.app = app;

import electron from 'electron';
import { State } from './state';
import {
  STATE_SAVE,
  STATE_SAVE_IMMEDIATE,
  UNCAUGHT_ERROR,
  UNZIP_GAME_OK,
  UNZIP_GAME_FAIL
} from './dispatch-types';

const { ipcRenderer } = electron;
// Save is restored on app load and saved before quitting
let state;

function getSavedState() {
  // Hack to avoid reactivity. Otherwise undefined is saved
  const vueTorrents = JSON.parse(JSON.stringify(app.$store.state.torrents));
  const result = {
      ...state,
      vue: {
          route: {
          name: app.$route.name,
          params: app.$route.params
        }
      },
      torrents: vueTorrents.map(t => {
          return {
            gameId: t.gameId,
            downloaded: t.downloaded,
            infoHash: t.infoHash,
            path: t.path,
            state: t.state,
            torrentFileName: t.torrentFileName,
            torrentURL: t.torrentURL
          };
        })
    };
  console.log('saved state=', result);
  console.log('vue state', app.$store.state);
  return result;
}


const dispatchHandlers = {
  [STATE_SAVE]: () => {
    State.save(getSavedState())
  },
  [STATE_SAVE_IMMEDIATE]: () => State.saveImmediate(getSavedState()),
  'error': (err) => {
    console.error(err.stack || err);
  },
  [UNCAUGHT_ERROR]: (err) => {
    console.error('Uncaught error', err.stack || err);
  }
};

function dispatch (action, ...args) {
  const handler = dispatchHandlers[action];
  if (handler) handler(...args);
  else console.error('Missing dispatch handler: ' + action)
}

import deepEqual from 'deep-equal';
import { START_DOWNLOAD_GAME, UNARCHIVE_GAME } from './store/actions-types';

function setupIpc() {
  ipcRenderer.on('wt-infohash', (e, torrentKey, infoHash) => {
    const { getters, commit } = app.$store;
    const { findTorrentByInfoHash } = getters;
    const existingTorrent = findTorrentByInfoHash(infoHash);
    if (existingTorrent && existingTorrent.torrentKey !== torrentKey) {
      ipcRenderer.send('wt-stop-torrenting', infoHash);
      return dispatch('error', 'Cannot add duplicate torrent');
    }
    commit({
      type: UPDATE_TORRENT_INFOHASH,
      payload: {
        torrentKey,
        infoHash
      }
    });
  });

  ipcRenderer.on('wt-metadata', (e, torrentKey, torrentInfo) => {
    const {commit, getters} = app.$store;
    const { findTorrentByKey } = getters;
    const torrent = findTorrentByKey(torrentKey);
    if (torrent) {
      commit({
        type: UPDATE_TORRENT,
        payload: {
          torrentKey,
          state: 'downloading',
          path: torrentInfo.path
        }
      });

      // Save the .torrent file, if it hasn't been saved already
      if (!torrent.torrentFileName)  {
        ipcRenderer.send('wt-save-torrent-file', torrentKey);
      }
    }
  });

  ipcRenderer.on('wt-file-saved', (e, torrentKey, torrentFileName) => {
    console.log('torrent file saved %s: %s', torrentKey, torrentFileName);

    const {commit, getters} = app.$store;
    const { findTorrentByKey } = getters;
    const torrent = findTorrentByKey(torrentKey);
    if (torrent) {
      commit({
        type: UPDATE_TORRENT,
        payload: {
          torrentKey,
          torrentFileName
        }
      });
      dispatch(STATE_SAVE);
    }
  });

  ipcRenderer.on('wt-progress', (e, progressInfo) => {
    progressInfo.torrents.forEach((p) => {
      const { torrentKey } = p;
      const {commit, getters} = app.$store;
      const { findTorrentByKey } = getters;
      const torrent = findTorrentByKey(torrentKey);
      // Skip progress update if torrent is not ready
      if (torrent && !deepEqual(torrent.progress, p) && p.ready) {
        if (torrent.downloaded && p.progress !== 1) {
          // Reset done
          commit({
            type: UPDATE_TORRENT,
            payload: {
              torrentKey,
              downloaded: false
            }
          });
        }
        const patch = {
          torrentKey,
          progress: p
        };
        commit({
          type: UPDATE_TORRENT_PROGRESS,
          payload: patch
        });
      }
    });
  });

  ipcRenderer.on('wt-done', (e, torrentKey, torrentInfo) => {
    const {commit, getters, dispatch} = app.$store;
    const { findTorrentByKey } = getters;
    const { files } = torrentInfo;
    const torrent = findTorrentByKey(torrentKey);
    // console.log('wt-done', torrentKey, torrent);
    if (torrent) {
      commit({
        type: UPDATE_TORRENT,
        payload: {
          torrentKey,
          downloaded: true,
          state: 'seeding',
          files
        }
      });
    }

    if (torrentInfo.bytesReceived > 0) {
      commit({
        type: TORRENT_DOWNLOADED,
        payload: {
          torrentKey,
        }
      });

      // Autorun unzip
      dispatch(UNARCHIVE_GAME, {
        gameId: torrent.gameId
      });
      // ipcRenderer.send('downloadFinished', getTorrentPath(torrentSummary))
    }
  });

  ipcRenderer.on(UNZIP_GAME_OK, (e, gameId) => {
    console.log('UNARCHIVE_OK', gameId);
    const {commit} = app.$store;
    commit({
      type: UNARCHIVE_OK,
      payload: {gameId}
    });
  });
  ipcRenderer.on(UNZIP_GAME_FAIL, (e, gameId) => {
    console.log('UNARCHIVE_FAIL', gameId);
    const {commit} = app.$store;
    commit({
      type: UNARCHIVE_FAIL,
      payload: {gameId}
    });
  });

  ipcRenderer.on('wt-warning', (e, torrentKey, message) => {
    console.warn(`torrentKey=${torrentKey}, msg: ${message}`);
  });

  ipcRenderer.on('wt-error', (e, torrentKey, message) => {
    console.error('wt-error',torrentKey, message);
    // const torrent = store.getters.findTorrentByKey(torrentKey);
    // const { state } = torrent;
    store.commit({
      type: UPDATE_TORRENT,
      payload: {
        torrentKey,
        state: 'error',
        errorMessage: message
      }
    });
  });

  ipcRenderer.on('dispatch', (e, ...args) => dispatch(...args));
  State.on('stateSaved', () => ipcRenderer.send('stateSaved'))
}

setupIpc();

// Remove all torrents to reset webtorrent state (fixes hot-reload issues because of desynchronization)
// FIXME: sometimes it finishes after load state
ipcRenderer.send('wt-reset');
ipcRenderer.once('wt-reset-ok', () => {
  State.load().then((s) => {
    state = s;
    console.log('main renderer state', s);
    // Improve Dev Exp: Restore last page you worked in
    if (IS_DEV && state.vue && state.vue.route) {
      app.$router.push(state.vue.route);
    }
    const { torrents = [] } = state;
    const {state: storeState, commit, dispatch} = app.$store;
    torrents.forEach(t => {
      if (!t || !t.infoHash) {
        console.warn(`Badly saved torrent`, t);
        return;
      }
      const torrentKey = storeState.nextTorrentKey;
      commit(NEXT_TORRENT_KEY_USED);
      const originalState = t.state;
      const torrent = {
        ...t,
        torrentKey,
        // Force pause
        state: 'paused'
      };
      console.log('restoring torrent state', torrent, {
        dwnld: t.downloaded,
        notpaused: originalState !== 'paused',
        start: t.downloaded || originalState !== 'paused'
      });
      commit({
        type: ADD_TORRENT,
        payload: torrent
      });
      if (t.downloaded || originalState !== 'paused') {
        console.log('dispatching start download', torrent.gameId);
        // seed downloaded or download not paused
        dispatch(START_DOWNLOAD_GAME, { gameId: torrent.gameId });
      }
    });
    // setInterval(() => { State.saveImmediate(getSavedState()) }, 5000);
  });
});
