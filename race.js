import { formatBigNumber, parseOperatorMetadata } from './utils.js';
import { SUBGRAPH_ID } from './constants.js';

const DEFAULT_API_KEY = 'bb77dd994c8e90edcbd73661a326f068';

// START DATE: March 18, 2024
const START_DATE_ISO = '2024-03-18T00:00:00Z';
const START_DATE = Math.floor(new Date(START_DATE_ISO).getTime() / 1000);

const DISPLAY_COUNT = 30; 
const SNAPSHOT_INTERVAL_DAYS = 15; 
const ROW_HEIGHT = 22; 
const SCALE_STEP_DATA = 500000; 

const BAR_COLORS = [
    'bg-blue-600', 'bg-purple-600', 'bg-pink-600', 'bg-indigo-600', 
    'bg-teal-600', 'bg-orange-600', 'bg-cyan-600', 'bg-rose-600',
    'bg-emerald-600', 'bg-violet-600',
    'bg-red-600', 'bg-yellow-600', 'bg-lime-600', 'bg-fuchsia-600',
    'bg-sky-600', 'bg-amber-600', 'bg-green-600', 'bg-slate-600'
];

const formatDate = (timestamp) => {
    return new Date(timestamp * 1000).toLocaleDateString('en-US', { 
        year: 'numeric', month: 'short', day: 'numeric' 
    });
};

export const RaceLogic = {
    state: {
        timelineData: [],
        operatorMetaMap: {},
        currentIndex: 0,
        isPlaying: false,
        playbackSpeed: 100,
        timer: null,
        domElements: new Map(),
        hasInitialized: false
    },

    els: {}, // Will be populated in init()

    init: async function() {
        // Cache elements with "race-" prefix to avoid collisions with main app
        this.els = {
            loadingState: document.getElementById('race-loading-state'),
            loadingBar: document.getElementById('race-loading-bar'),
            loadingText: document.getElementById('race-loading-text'),
            errorState: document.getElementById('race-error-state'),
            errorMsg: document.getElementById('race-error-msg'),
            chartArea: document.getElementById('race-chart-area'),
            controlsArea: document.getElementById('race-controls-area'),
            barsContainer: document.getElementById('race-bars-container'),
            bgYear: document.getElementById('race-bg-year'),
            bgDate: document.getElementById('race-bg-date'),
            lblStartDate: document.getElementById('race-lbl-start-date'),
            lblCurrentDate: document.getElementById('race-lbl-current-date'),
            slider: document.getElementById('race-timeline-slider'),
            btnPlay: document.getElementById('race-btn-play'),
            btnSpeed: document.getElementById('race-btn-speed'),
            btnReload: document.getElementById('race-btn-reload')
        };

        // Event Listeners (only add once)
        if (!this.state.hasInitialized) {
            this.els.btnPlay?.addEventListener('click', () => this.togglePlay());
            this.els.btnReload?.addEventListener('click', () => this.loadData());
            this.els.btnSpeed?.addEventListener('click', () => this.toggleSpeed());
            this.els.slider?.addEventListener('input', (e) => {
                this.state.isPlaying = false;
                this.updatePlayButton();
                this.state.currentIndex = parseInt(e.target.value);
                this.renderFrame(this.state.currentIndex);
            });
            this.state.hasInitialized = true;
        }

        // Reset and Load
        this.resetUI();
        try {
            await this.loadData();
        } catch (err) {
            console.error(err);
            this.els.loadingState.classList.add('hidden');
            if(this.els.errorMsg) this.els.errorMsg.textContent = err.message || "Error loading data";
            this.els.errorState.classList.remove('hidden');
        }
    },

    stop: function() {
        this.state.isPlaying = false;
        if (this.state.timer) {
            clearTimeout(this.state.timer);
            this.state.timer = null;
        }
        this.updatePlayButton();
    },

    resetUI: function() {
        this.stop();
        this.els.errorState.classList.add('hidden');
        this.els.chartArea.classList.add('hidden');
        this.els.controlsArea.classList.add('hidden');
        this.els.loadingState.classList.remove('hidden');
        this.els.loadingBar.style.width = '0%';
        this.els.loadingText.textContent = "Discovering operators...";
        
        this.state.currentIndex = 0;
        this.state.timelineData = [];
        this.state.domElements.clear();
        this.els.barsContainer.innerHTML = ''; 
        this.updatePlayButton();
    },

    getGraphUrl: function() {
        const apiKey = localStorage.getItem('the-graph-api-key') || DEFAULT_API_KEY;
        return `https://gateway-arbitrum.network.thegraph.com/api/${apiKey}/subgraphs/id/${SUBGRAPH_ID}`;
    },

    // --- SMART DISCOVERY ALGORITHM ---
    discoverTopOperators: async function() {
        const uniqueOperatorIds = new Set();
        const now = Math.floor(Date.now() / 1000);
        const interval = SNAPSHOT_INTERVAL_DAYS * 24 * 60 * 60;
        let checkpoints = [];

        for (let t = START_DATE; t <= now; t += interval) {
            checkpoints.push(t);
        }
        checkpoints.push(now); 

        let queryBody = '';
        checkpoints.forEach((ts, idx) => {
            queryBody += `
                t${idx}: operatorDailyBuckets(
                    first: 40
                    orderBy: valueWithoutEarnings
                    orderDirection: desc
                    where: { date_gte: "${ts}", date_lt: "${ts + 86400}" }
                ) {
                    operator { id }
                }
            `;
        });

        // Also get current top to ensure we don't miss recent risers
        queryBody += `
            currentTop: operators(
                first: 50
                orderBy: valueWithoutEarnings
                orderDirection: desc
            ) {
                id
            }
        `;

        const batchQuery = `query { ${queryBody} }`;

        this.els.loadingText.textContent = `Scanning history (${checkpoints.length} snapshots)...`;
        this.els.loadingBar.style.width = '30%';

        const res = await fetch(this.getGraphUrl(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: batchQuery })
        });

        const json = await res.json();
        if (json.errors) throw new Error(json.errors[0].message);

        Object.values(json.data).forEach(group => {
            group.forEach(item => {
                const id = item.operator ? item.operator.id : item.id;
                uniqueOperatorIds.add(id);
            });
        });

        console.log(`[Race] Found ${uniqueOperatorIds.size} distinct operators.`);
        return Array.from(uniqueOperatorIds);
    },

    loadData: async function() {
        const operatorIds = await this.discoverTopOperators();
        
        this.els.loadingText.textContent = "Fetching details...";
        this.els.loadingBar.style.width = '50%';

        const chunkSize = 100;
        for (let i = 0; i < operatorIds.length; i += chunkSize) {
            const chunk = operatorIds.slice(i, i + chunkSize);
            const metaQuery = `
                query {
                    operators(where: { id_in: ${JSON.stringify(chunk)} }, first: 1000) {
                        id
                        metadataJsonString
                    }
                }
            `;
            const metaRes = await fetch(this.getGraphUrl(), {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ query: metaQuery })
            });
            const metaJson = await metaRes.json();
            if (metaJson.data && metaJson.data.operators) {
                metaJson.data.operators.forEach(op => {
                    const { name } = parseOperatorMetadata(op.metadataJsonString);
                    this.state.operatorMetaMap[op.id] = {
                        name: name || `Operator ${op.id.slice(0, 6)}`,
                        color: BAR_COLORS[parseInt(op.id.slice(-1), 16) % BAR_COLORS.length]
                    };
                });
            }
        }

        this.els.loadingText.textContent = "Reconstructing timeline...";
        let allBuckets = [];
        let lastDate = START_DATE;
        let fetching = true;
        let progress = 50;

        while(fetching) {
            progress = Math.min(progress + 5, 95);
            this.els.loadingBar.style.width = `${progress}%`;

            const histQuery = `
                query GetHistory($ids: [ID!], $since: BigInt!) {
                    operatorDailyBuckets(
                        where: { operator_in: $ids, date_gt: $since }
                        first: 1000
                        orderBy: date
                        orderDirection: asc
                    ) {
                        date, valueWithoutEarnings, operator { id }
                    }
                }
            `;

            const res = await fetch(this.getGraphUrl(), {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    query: histQuery,
                    variables: { ids: operatorIds, since: lastDate.toString() }
                })
            });
            const json = await res.json();
            if(json.errors) throw new Error("History error");
            
            const buckets = json.data.operatorDailyBuckets;
            if(buckets.length === 0) {
                fetching = false;
            } else {
                allBuckets = [...allBuckets, ...buckets];
                lastDate = buckets[buckets.length - 1].date;
                // Safety break if < 1000 returned, means we reached end
                if(buckets.length < 1000) fetching = false;
            }
        }

        this.els.loadingBar.style.width = '100%';

        this.processTimeline(allBuckets, operatorIds);
        
        this.els.loadingState.classList.add('hidden');
        this.els.chartArea.classList.remove('hidden');
        this.els.controlsArea.classList.remove('hidden');
        this.renderFrame(0);
    },

    processTimeline: function(buckets, operatorIds) {
        const bucketsByDate = {};
        const uniqueDates = new Set();

        buckets.forEach(b => {
            const d = parseInt(b.date);
            uniqueDates.add(d);
            if(!bucketsByDate[d]) bucketsByDate[d] = {};
            bucketsByDate[d][b.operator.id] = b.valueWithoutEarnings;
        });

        const sortedDates = Array.from(uniqueDates).sort((a,b) => a - b);
        
        if(sortedDates.length === 0) throw new Error("No data found");

        let lastKnownValues = {};
        operatorIds.forEach(id => lastKnownValues[id] = '0');

        this.state.timelineData = sortedDates.map(date => {
            const daysData = bucketsByDate[date];
            if(daysData) {
                Object.keys(daysData).forEach(opId => {
                    lastKnownValues[opId] = daysData[opId];
                });
            }

            const rankings = operatorIds
            .filter(id => this.state.operatorMetaMap[id]) 
            .map(id => ({
                id: id,
                value: lastKnownValues[id],
                floatValue: parseFloat(lastKnownValues[id]), // Float representation of Wei
                ...this.state.operatorMetaMap[id]
            }))
            .sort((a,b) => b.floatValue - a.floatValue)
            .filter(op => op.floatValue > 1000) 
            .slice(0, DISPLAY_COUNT); 

            return {
                date: date,
                formattedDate: formatDate(date),
                rankings: rankings
            };
        });

        this.els.slider.max = this.state.timelineData.length - 1;
        this.els.lblStartDate.textContent = this.state.timelineData[0].formattedDate;
    },

    renderFrame: function(index) {
        const frame = this.state.timelineData[index];
        if(!frame) return;

        const year = new Date(frame.date * 1000).getFullYear();
        this.els.bgYear.textContent = year;
        this.els.bgDate.textContent = frame.formattedDate;
        this.els.lblCurrentDate.textContent = frame.formattedDate;
        this.els.slider.value = index;

        const maxValWei = frame.rankings.length > 0 ? frame.rankings[0].floatValue : 1;
        const activeIds = new Set(frame.rankings.map(r => r.id));

        frame.rankings.forEach((item, rank) => {
            let el = this.state.domElements.get(item.id);

            if(!el) {
                el = document.createElement('div');
                el.className = 'bar-row';
                el.style.top = '700px'; // Initial off-screen pos
                el.innerHTML = `
                    <div class="w-6 text-[10px] text-gray-500 font-bold text-right shrink-0 rank-num"></div>
                    <div class="w-32 flex items-center justify-end shrink-0">
                        <span class="text-[11px] font-medium text-gray-300 truncate max-w-full text-right operator-name"></span>
                    </div>
                    <div class="flex-1 flex items-center gap-2 h-full bar-track">
                        <div class="bar-fill shadow-sm bg-opacity-90"></div>
                        <span class="text-[9px] font-bold text-gray-400 tabular-nums value-text whitespace-nowrap"></span>
                    </div>
                `;
                el.querySelector('.operator-name').textContent = item.name;
                el.querySelector('.operator-name').title = item.name;
                el.querySelector('.bar-fill').classList.add(...item.color.split(' ')); 
                this.els.barsContainer.appendChild(el);
                this.state.domElements.set(item.id, el);
            }

            el.classList.remove('bar-hidden'); 
            el.style.top = `${rank * ROW_HEIGHT}px`;
            el.querySelector('.rank-num').textContent = rank + 1;
            
            // Convert wei to data for scale calculation (DATA token has 18 decimals)
            const valData = item.floatValue / 1e18;
            const widthPercent = Math.max((item.floatValue / maxValWei) * 100, 0.5);
            
            const barFill = el.querySelector('.bar-fill');
            barFill.style.width = `${widthPercent}%`;
            
            // Reuse Utils.formatBigNumber but adapted for the Race look (compact)
            el.querySelector('.value-text').textContent = formatBigNumber(Math.floor(valData).toString());

            // SCALE MARKERS
            barFill.querySelectorAll('.scale-marker-line').forEach(m => m.remove());

            const numberOfMarkers = Math.floor(valData / SCALE_STEP_DATA);

            for (let i = 1; i <= numberOfMarkers; i++) {
                const markerValueData = i * SCALE_STEP_DATA;
                const posPercent = (markerValueData / valData) * 100;
                
                if (posPercent < 99) { 
                    const line = document.createElement('div');
                    line.className = 'scale-marker-line';
                    line.style.left = `${posPercent}%`;
                    barFill.appendChild(line);
                }
            }
        });

        this.state.domElements.forEach((el, id) => {
            if (!activeIds.has(id)) {
                el.classList.add('bar-hidden');
                el.style.top = '700px'; 
            }
        });
    },

    togglePlay: function() {
        this.state.isPlaying = !this.state.isPlaying;
        this.updatePlayButton();
        if (this.state.isPlaying) {
            if (this.state.currentIndex >= this.state.timelineData.length - 1) {
                this.state.currentIndex = 0;
            }
            this.loop();
        } else {
            if (this.state.timer) clearTimeout(this.state.timer);
        }
    },

    loop: function() {
        if (!this.state.isPlaying) return;
        this.renderFrame(this.state.currentIndex);
        if (this.state.currentIndex >= this.state.timelineData.length - 1) {
            this.state.isPlaying = false;
            this.updatePlayButton();
            return;
        }
        this.state.currentIndex++;
        this.state.timer = setTimeout(() => this.loop(), this.state.playbackSpeed);
    },

    updatePlayButton: function() {
        if (!this.els.btnPlay) return;
        
        if (this.state.isPlaying) {
            // Pause Icon
            this.els.btnPlay.innerHTML = '<svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>';
        } else {
            // Play Icon
            this.els.btnPlay.innerHTML = '<svg class="w-4 h-4 fill-current ml-1" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';
        }
    },

    toggleSpeed: function() {
        this.state.playbackSpeed = this.state.playbackSpeed === 100 ? 30 : 100;
        const btn = this.els.btnSpeed;
        if (this.state.playbackSpeed === 30) {
            btn.classList.add('bg-blue-900', 'border-blue-800', 'text-blue-200');
            btn.classList.remove('bg-[#2C2C2C]', 'text-gray-400', 'border-[#333333]');
        } else {
            btn.classList.remove('bg-blue-900', 'border-blue-800', 'text-blue-200');
            btn.classList.add('bg-[#2C2C2C]', 'text-gray-400', 'border-[#333333]');
        }
    }
};