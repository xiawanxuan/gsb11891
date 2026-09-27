/*
 * db.js — IndexedDB 持久化：保存基准测试结果与降级事件日志。
 */
(function (root) {
  'use strict';

  var DB_NAME = 'typed-om-lab';
  var DB_VERSION = 1;
  var dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB 不可用'));
        return;
      }
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains('benchmarks')) {
          db.createObjectStore('benchmarks', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('fallbacks')) {
          db.createObjectStore('fallbacks', { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbPromise;
  }

  function put(storeName, record) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).add(record);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function all(storeName) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(storeName, 'readonly');
        var req = tx.objectStore(storeName).getAll();
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  root.LabDB = {
    saveBenchmark: function (r) { return put('benchmarks', r); },
    saveFallback: function (r) { return put('fallbacks', r); },
    listBenchmarks: function () { return all('benchmarks'); },
    listFallbacks: function () { return all('fallbacks'); }
  };
})(typeof self !== 'undefined' ? self : this);
