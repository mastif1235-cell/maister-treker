(function(root){
  'use strict';
  const entries=Object.freeze({
    settings:{key:'settings',owner:'settings-core',persistence:'persistent',secret:true},
    shifts:{key:'shifts',owner:'storage-orchestration',persistence:'persistent',secret:false},
    deletedTickets:{key:'deletedTickets',owner:'tickets-domain',persistence:'persistent',secret:false},
    naryadQueue:{key:'naryadQueue',owner:'storage-orchestration',persistence:'persistent',secret:false},
    ticketDraft:{key:'ticketDraft',owner:'ticket-editor-domain',persistence:'temporary',secret:true},
    dailyMasters:{key:'dailyMastersDefault',owner:'ticket-editor-domain',persistence:'daily',secret:false},
    pendingTickets:{key:'pendingTicketsFallback',owner:'ticket-state-storage',persistence:'emergency',secret:true},
    diagnostics:{key:'mtSavedDiagnosticsV1',owner:'tools-domain',persistence:'persistent',secret:true},
    networkPoints:{key:'mtNetworkPointsV1',owner:'tools-domain',persistence:'persistent',secret:true},
    toolsDraft:{key:'mtToolsCalculatorDraftV1',owner:'tools-domain',persistence:'temporary',secret:true},
    offlineAreas:{key:'mtOfflineAreasV1',owner:'tools-domain',persistence:'persistent',secret:false},
    offlineLegacyBounds:{key:'mtOfflineAreaBoundsV1',owner:'tools-domain',persistence:'legacy-read',secret:false},
    offlineMeta:{key:'mtOfflineMapMetaV1',owner:'offline-map-storage',persistence:'persistent',secret:false},
    offlineMode:{key:'mtOfflineMapModeV1',owner:'offline-map-storage',persistence:'persistent',secret:false},
    mapTilerKey:{key:'mt-maptiler-key-v1',owner:'maptiler-local-config',persistence:'device-secret',secret:true},
    mapLayer:{key:'mt-map-layer-v1',owner:'maptiler-local-config',persistence:'persistent',secret:false},
    writerLease:{key:'mt-single-writer-lease-v1',owner:'single-writer-lock',persistence:'lease',secret:false},
    lockThrottle:{key:'appLockThrottleV1',owner:'security-lock',persistence:'security-state',secret:false},
    dailyBackupIndex:{key:'dailyBackupIndex',owner:'local-state-storage',persistence:'persistent',secret:false},
    externalBackupDate:{key:'externalDailyBackupDate',owner:'backup-system',persistence:'daily',secret:false},
    cleanupReminder:{key:'cleanupReminderMonth',owner:'storage-orchestration',persistence:'monthly',secret:false},
    telegramMonthly:{key:'tgMonthlyReportMonth',owner:'photo-telegram-domain',persistence:'monthly',secret:false},
    syncMigration:{key:'mtSyncV3ShiftsMigrated',owner:'app',persistence:'migration-marker',secret:false}
  });
  function safeJsonGet(storage,key,fallback,validate){
    try{const raw=storage?.getItem?.(key);if(raw===null||raw===undefined)return fallback;const value=JSON.parse(raw);return(!validate||validate(value))?value:fallback;}catch(_error){return fallback;}
  }
  root.MTStorageRegistry=Object.freeze({entries,key:name=>entries[name]?.key||'',safeJsonGet});
})(typeof window!=='undefined'?window:globalThis);
