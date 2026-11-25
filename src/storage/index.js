(function (global) {
    'use strict';

    const factories = global.CLTStorageFactories || {};
    const backendName = String(global.CLT_STORAGE_BACKEND || 'supabase').toLowerCase();
    let adapter = null;
    let metadata = null;

    async function fetchText(path) {
        const response = await fetch(path, { cache: 'no-store' });
        if (!response.ok) throw new Error(`Unable to load ${path}: HTTP ${response.status}`);
        return (await response.text()).trim();
    }

    async function loadDeploymentMetadata() {
        const result = { experimentVersion: 'unknown', gitCommit: 'unknown' };
        try {
            result.experimentVersion = (await fetchText('VERSION')) || 'unknown';
        } catch (error) {
            console.warn('[CLT storage] VERSION could not be loaded:', error.message);
        }
        try {
            const response = await fetch('build-info.json', { cache: 'no-store' });
            if (response.ok) {
                const info = await response.json();
                if (info.experiment_version) result.experimentVersion = String(info.experiment_version);
                if (info.git_commit) result.gitCommit = String(info.git_commit);
            }
        } catch (error) {
            console.warn('[CLT storage] build-info.json is unavailable; Git commit is unknown.');
        }
        return result;
    }

    function createLocalFallback() {
        return {
            initialize: async () => {},
            saveTrial: () => Promise.resolve(),
            saveCheckpoint: () => Promise.resolve(),
            loadProgress: () => Promise.resolve(null),
            saveProgress: () => Promise.resolve(false),
            clearProgress: () => Promise.resolve(false),
            saveFinalResult: async () => ({ message: '云端存储不可用，仅生成本地 Excel。' }),
            finishExperiment: () => Promise.resolve({ message: '' })
        };
    }

    function requireAdapter() {
        if (!adapter) throw new Error('Storage has not been initialized');
        return adapter;
    }

    global.CLTStorage = {
        backendName,
        async initializeStorage(context) {
            metadata = await loadDeploymentMetadata();
            const factory = factories[backendName];
            if (typeof factory !== 'function') {
                console.warn('[CLT storage] backend unavailable; using local Excel fallback.');
                adapter = createLocalFallback();
                return { backend: 'local', ...metadata };
            }
            try {
                adapter = factory(metadata);
                await adapter.initialize({ ...context, experimentVersion: metadata.experimentVersion, gitCommit: metadata.gitCommit });
                return { backend: backendName, ...metadata };
            } catch (error) {
                console.warn('[CLT storage] cloud initialization failed; using local Excel fallback.', error);
                adapter = createLocalFallback();
                return { backend: 'local', ...metadata };
            }
        },
        saveTrial(data) { return requireAdapter().saveTrial(data); },
        saveCheckpoint(data) { return requireAdapter().saveCheckpoint(data); },
        loadProgress() {
            if (!adapter || typeof adapter.loadProgress !== 'function') return Promise.resolve(null);
            return adapter.loadProgress();
        },
        saveProgress(data) {
            if (!adapter || typeof adapter.saveProgress !== 'function') return Promise.resolve(false);
            return adapter.saveProgress(data);
        },
        clearProgress() {
            if (!adapter || typeof adapter.clearProgress !== 'function') return Promise.resolve(false);
            return adapter.clearProgress();
        },
        saveFinalResult(data) { return requireAdapter().saveFinalResult(data); },
        finishExperiment(data) { return requireAdapter().finishExperiment(data); },
        getMetadata() { return metadata ? { ...metadata, backend: backendName } : { backend: backendName }; }
    };
})(window);
