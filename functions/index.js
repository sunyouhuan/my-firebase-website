// ==========================================
    // 🔥 前端 UI 渲染邏輯 (請貼在 script 標籤底部) 🔥
    // ==========================================

    // 1. 監聽 Firestore 數據
    let unsubSocial = null;
    window.listenForSocialStats = function(uid) {
        if (unsubSocial) unsubSocial();
        console.log("正在監聽用戶數據:", uid);
        unsubSocial = onSnapshot(doc(db, "users", uid), (docSnap) => {
            if (docSnap.exists()) {
                const igData = docSnap.data().social_stats?.current?.ig;
                if (igData && igData.connected) {
                    updateDashboardWithRealData(igData);
                }
            }
        });
    }

    // 2. 主渲染函式
    window.updateDashboardWithRealData = function(igData) {
        if (!igData) return;

        // 更新大頭貼與文字
        if (igData.avatar) {
            const els = [document.getElementById('dash-inf-avatar'), document.getElementById('inf-card-avatar'), document.getElementById('overview-inf-avatar')];
            els.forEach(el => { if(el) el.src = igData.avatar; });
        }
        if (igData.username) {
            [document.getElementById('dash-inf-name'), document.getElementById('inf-card-name')].forEach(el => { if(el) el.textContent = `@${igData.username}`; });
        }
        
        // 更新數字
        document.getElementById('total-fans').textContent = (igData.followers || 0).toLocaleString();
        
        const avgErEl = document.getElementById('avg-er');
        if(avgErEl) {
            avgErEl.innerHTML = `${((igData.avgEr || 0) * 100).toFixed(2)}%`;
            avgErEl.parentElement.querySelector('p').textContent = "平均互動率 (ER)";
        }

        // 更新連結按鈕狀態
        const btn = document.getElementById('btn-connect-ig');
        const status = document.getElementById('status-ig');
        if (btn) { btn.textContent = "已連結"; btn.disabled = true; btn.className = "text-xs bg-green-100 text-green-700 border border-green-200 px-3 py-1.5 rounded-lg font-bold"; }
        if (status) { status.textContent = "✅ 數據已同步"; status.className = "text-green-600 text-xs font-bold"; }

        // 顯示分析區塊
        document.getElementById('analytics-dashboard').classList.remove('hidden');

        // 🔥 繪製「堆疊長條圖」 (人口統計)
        if (igData.demographics && Object.keys(igData.demographics.gender_age || {}).length > 0) {
            renderDemographicCharts(igData.demographics.gender_age);
        } else {
            console.log("無人口統計數據 (粉絲不足100)");
        }

        // 🔥 繪製 30天觸及趨勢圖
        if (igData.dailyTrend) renderTrendChart(igData.dailyTrend);

        // 🔥 顯示限動牆
        if (igData.activeStories && igData.activeStories.length > 0) {
            renderStoriesGallery(igData.activeStories);
        }

        // 🔥 顯示貼文牆
        if (igData.recentPosts) renderRecentPostsGallery(igData.recentPosts);
    }

    // --- 圖表 1: 男女年齡堆疊圖 (Stacked Bar) ---
    let chartDemoInstance = null;
    window.renderDemographicCharts = function(genderAgeData) {
        const ctx = document.getElementById('chart-demo')?.getContext('2d');
        if (!ctx) return;
        if (chartDemoInstance) chartDemoInstance.destroy();

        // 資料處理
        const ageSet = new Set();
        Object.keys(genderAgeData).forEach(key => ageSet.add(key.split('.')[1]));
        const labels = Array.from(ageSet).sort(); // 年齡層 X軸

        const femaleData = [];
        const maleData = [];

        labels.forEach(age => {
            femaleData.push(genderAgeData[`F.${age}`] || 0);
            maleData.push(genderAgeData[`M.${age}`] || 0);
        });

        // 修改標題
        const titleEl = document.getElementById('chart-demo').parentElement.querySelector('h3');
        if(titleEl) titleEl.textContent = "各年齡層性別比例 (Gender by Age)";

        chartDemoInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: '女性 (Female)',
                        data: femaleData,
                        backgroundColor: '#f472b6',
                        stack: 'Stack 0', // 關鍵：設為同一組
                    },
                    {
                        label: '男性 (Male)',
                        data: maleData,
                        backgroundColor: '#60a5fa',
                        stack: 'Stack 0', // 關鍵：設為同一組
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { stacked: true }, // X軸堆疊
                    y: { stacked: true }  // Y軸堆疊
                }
            }
        });
    }

    // --- 圖表 2: 趨勢圖 ---
    let chartTrendInstance = null;
    window.renderTrendChart = function(trendData) {
        const ctx = document.getElementById('chart-followers')?.getContext('2d');
        if (!ctx || trendData.length === 0) return;
        if (chartTrendInstance) chartTrendInstance.destroy();

        const titleEl = document.getElementById('chart-followers').parentElement.querySelector('h3');
        if(titleEl) titleEl.textContent = "30天觸及人數趨勢";

        chartTrendInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: trendData.map(d => new Date(d.date).toLocaleDateString().slice(5)),
                datasets: [{
                    label: '每日觸及',
                    data: trendData.map(d => d.value),
                    borderColor: '#0d9488',
                    backgroundColor: 'rgba(13, 148, 136, 0.1)',
                    fill: true,
                    tension: 0.4
                }]
            },
            options: { responsive: true, maintainAspectRatio: false }
        });
    }

    // --- 區塊: 限時動態牆 ---
    window.renderStoriesGallery = function(stories) {
        let container = document.getElementById('ig-stories-gallery');
        if (!container) {
            const dashboard = document.getElementById('analytics-dashboard');
            const section = document.createElement('div');
            section.className = "bg-white rounded-xl shadow p-6 mt-6 border-l-4 border-pink-500";
            section.innerHTML = `<h3 class="font-bold text-slate-800 mb-4">🟣 限時動態 (Live Stories)</h3><div id="ig-stories-gallery" class="flex gap-4 overflow-x-auto pb-2"></div>`;
            dashboard.prepend(section);
            container = document.getElementById('ig-stories-gallery');
        }
        container.innerHTML = stories.map(s => `
            <div class="flex-shrink-0 w-20 flex flex-col items-center">
                <div class="w-16 h-16 rounded-full p-[2px] bg-gradient-to-tr from-yellow-400 to-purple-600">
                    <img src="${s.thumbnail_url || s.media_url}" class="w-full h-full rounded-full object-cover border-2 border-white">
                </div>
                <div class="text-xs font-bold mt-1">👀 ${s.insights?.reach || 0}</div>
            </div>
        `).join('');
    }

    // --- 區塊: 貼文牆 ---
    window.renderRecentPostsGallery = function(posts) {
        let container = document.getElementById('ig-posts-gallery');
        if (!container) {
            const dashboard = document.getElementById('analytics-dashboard');
            const section = document.createElement('div');
            section.className = "bg-white rounded-xl shadow p-6 mt-6";
            section.innerHTML = `<h3 class="font-bold text-slate-800 mb-4 border-b pb-2">📸 最新貼文成效</h3><div id="ig-posts-gallery" class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3"></div>`;
            dashboard.appendChild(section);
            container = document.getElementById('ig-posts-gallery');
        }
        container.innerHTML = posts.map(p => `
            <a href="${p.permalink}" target="_blank" class="block aspect-square bg-gray-100 rounded-lg overflow-hidden relative group">
                <img src="${p.thumbnail_url || p.media_url}" class="w-full h-full object-cover">
                <div class="absolute inset-0 bg-black/40 flex flex-col items-center justify-center text-white opacity-0 group-hover:opacity-100 transition">
                    <span class="font-bold">👀 ${p.insights?.reach || 0}</span>
                    <span class="text-xs">❤️ ${p.like_count}</span>
                </div>
            </a>
        `).join('');
    }