// app.js - 多教材生詞分析助手 (來學華語/當代中文 + TBCL)

// 全域資料
let tbclData = {};
let dataSources = {
    lai: {}, // 來學華語
    mtc: {}  // 當代中文
};
let currentSource = 'lai'; // 當前選擇的教材

// 狀態
let selectedLessons = new Set(); // 已勾選的課 (格式: "lai:B1" 或 "mtc:1-1")
let customVocab = new Set();     // 手動補充的詞
let knownWords = new Set();      // 斷詞參考庫 (所有教材詞彙)

// 反向索引：詞 -> 最早出處 (用於顯示標籤)
// 結構: { lai: { "你好": "B1" }, mtc: { "你好": "1-1" } }
let reverseIndex = { lai: {}, mtc: {} };

let editingIndex = -1;
let lastAnalysisResult = [];

document.addEventListener('DOMContentLoaded', async () => {
    await loadAllData();
    setupEvents();
    initBackdropSync();
    setSource('lai'); // 預設顯示來學華語
});

// 1. 載入資料
async function loadAllData() {
    try {
        const [tbcl, lai, mtc] = await Promise.all([
            fetch('tbcl_data.json').then(r => r.json()),
            fetch('learn_chinese_data.json').then(r => r.json()),
            fetch('mtc_data.json').then(r => r.json())
        ]);

        tbclData = tbcl;
        dataSources.lai = lai;
        dataSources.mtc = mtc;

        // 預處理：建立斷詞庫與反向索引
        processDataSource('lai', lai);
        processDataSource('mtc', mtc);

        console.log('資料載入完成');
    } catch (e) {
        console.error(e);
        alert('載入資料失敗，請確認 JSON 檔案是否存在');
    }
}

function processDataSource(sourceName, data) {
    // 建立反向索引 & 加入斷詞庫
    // 需要排序課別，確保找到的是「最早」出處 (例如 1-1 比 1-5 早)
    const sortedKeys = Object.keys(data).sort(naturalSort);
    
    sortedKeys.forEach(lesson => {
        const words = data[lesson];
        if (Array.isArray(words)) {
            words.forEach(w => {
                knownWords.add(w); // 加入斷詞參考
                
                // 記錄最早出處 (如果還沒記錄過)
                if (!reverseIndex[sourceName][w]) {
                    reverseIndex[sourceName][w] = lesson;
                }
            });
        }
    });
}

// 2. 切換教材
window.setSource = function(source) {
    currentSource = source;
    
    // 更新按鈕 UI
    document.querySelectorAll('.source-btn').forEach(btn => btn.classList.remove('active'));
    const activeBtnText = source === 'lai' ? '來學華語' : '當代中文';
    Array.from(document.querySelectorAll('.source-btn'))
         .find(b => b.textContent.includes(activeBtnText))
         ?.classList.add('active');

    renderCheckboxes();
    // 切換教材時，是否要保留已勾選的 "其他教材" 課程？
    // 為了避免混亂，通常顯示什麼就過濾什麼。但資料結構 selectedLessons 有 prefix，所以互不衝突。
    // 更新 UI 顯示的計數
    updateSelectedCount();
    
    // 如果有文字，重新分析以更新標籤 (出處標籤會變)
    if (document.getElementById('inputText').value.trim()) {
        analyzeText();
    }
}

// 3. 渲染勾選清單 (分組邏輯)
function renderCheckboxes() {
    const container = document.getElementById('lessonSelector');
    container.innerHTML = '';
    
    const data = dataSources[currentSource];
    const keys = Object.keys(data).sort(naturalSort);
    
    // 分組
    const groups = {};
    const groupOrder = []; // 保持順序

    keys.forEach(key => {
        let groupName = '全冊';
        // MTC: 1-1 -> 第 1 冊
        if (key.match(/^\d+-\d+/)) {
            const book = key.split('-')[0];
            groupName = `第 ${book} 冊`;
        }
        // Lai: B1 -> B1 (或者可以歸類為 "第一冊")
        else if (key.match(/^B\d+/)) {
            // 來學華語直接用 B1, B2 當群組
            groupName = key;
        }

        if (!groups[groupName]) {
            groups[groupName] = [];
            groupOrder.push(groupName);
        }
        groups[groupName].push(key);
    });

    // 產生 HTML
    groupOrder.forEach(gName => {
        const subKeys = groups[gName];
        const groupDiv = document.createElement('div');
        groupDiv.className = 'book-group';

        // 標題列 (含全選)
        const header = document.createElement('div');
        header.className = 'book-header';
        
        const masterCb = document.createElement('input');
        masterCb.type = 'checkbox';
        masterCb.onclick = (e) => toggleGroup(e, subKeys);
        
        // 檢查群組狀態
        const prefix = currentSource + ':';
        const allChecked = subKeys.every(k => selectedLessons.has(prefix + k));
        const someChecked = subKeys.some(k => selectedLessons.has(prefix + k));
        masterCb.checked = allChecked && subKeys.length > 0;
        masterCb.indeterminate = someChecked && !allChecked;

        // 如果是 B1 這種單一群組，顯示詞數；如果是多課群組，顯示課數
        let titleText = gName;
        if (subKeys.length === 1 && subKeys[0] === gName) {
             const count = data[gName].length;
             titleText += ` (${count} 詞)`;
        } else {
             titleText += ` (${subKeys.length} 課)`;
        }

        const title = document.createElement('span');
        title.textContent = ' ' + titleText;
        
        header.append(masterCb, title);
        
        // 內容區
        const content = document.createElement('div');
        content.className = 'book-content';
        
        // MTC 預設展開第一冊
        if (gName === '第 1 冊' || gName === 'B1') content.classList.add('open');

        // 點擊標題展開
        header.onclick = (e) => {
            if (e.target !== masterCb) content.classList.toggle('open');
        };

        // 如果不是單一項目 (像 Lai B1)，才顯示子選單
        if (!(subKeys.length === 1 && subKeys[0] === gName)) {
            subKeys.forEach(k => {
                const label = document.createElement('label');
                label.className = 'checkbox-item';
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.checked = selectedLessons.has(prefix + k);
                cb.onchange = () => toggleLesson(prefix + k);
                label.append(cb, k);
                content.append(label);
            });
            groupDiv.append(header, content);
        } else {
            // 單一項目 (B1) 只有 Header
            groupDiv.append(header);
        }
        
        container.append(groupDiv);
    });
}

function toggleGroup(e, keys) {
    e.stopPropagation();
    const checked = e.target.checked;
    const prefix = currentSource + ':';
    keys.forEach(k => {
        if (checked) selectedLessons.add(prefix + k);
        else selectedLessons.delete(prefix + k);
    });
    renderCheckboxes(); // 重繪以更新子項目狀態
    updateSelectedCount();
    if (document.getElementById('inputText').value.trim()) analyzeText();
}

function toggleLesson(fullKey) {
    if (selectedLessons.has(fullKey)) selectedLessons.delete(fullKey);
    else selectedLessons.add(fullKey);
    
    // 更新父層狀態比較麻煩，直接重繪最快
    renderCheckboxes();
    updateSelectedCount();
    if (document.getElementById('inputText').value.trim()) analyzeText();
}

function updateSelectedCount() {
    const prefix = currentSource + ':';
    let count = 0;
    selectedLessons.forEach(k => { if (k.startsWith(prefix)) count++; });
    document.getElementById('selectedCount').innerText = count;
}

// 4. 分析核心
function analyzeText() {
    const text = document.getElementById('inputText').value;
    if (!text.trim()) return;

    // 清空背景
    document.getElementById('inputBackdrop').innerHTML = '';

    // 1. 準備過濾清單 (Blocklist)
    const blocklist = new Set(customOldVocab);
    selectedLessons.forEach(fullKey => {
        const [src, key] = fullKey.split(':');
        const list = dataSources[src]?.[key];
        if (list) list.forEach(w => blocklist.add(w));
    });

    // 2. 斷詞
    let words = [];
    const useAdvanced = document.getElementById('useAdvancedSegmenter').checked;
    
    // 斷詞參考庫：包含 TBCL + 所有教材詞 + 手動詞
    const segmentDict = { ...tbclData };
    knownWords.forEach(w => { if (!segmentDict[w]) segmentDict[w] = '0'; });
    
    if (useAdvanced && typeof advancedSegment !== 'undefined') {
        words = advancedSegment(text, segmentDict, blocklist, true, true);
    } else {
        const segmenter = new Intl.Segmenter('zh-TW', { granularity: 'word' });
        words = Array.from(segmenter.segment(text)).map(s => s.segment);
    }

    // 3. 過濾與標註
    const results = [];
    const seen = new Set();

    words.forEach(w => {
        if (/^[^\w\u4e00-\u9fa5]+$/.test(w) || !w.trim()) return; // 跳過標點
        if (blocklist.has(w)) return; // 過濾舊詞
        if (seen.has(w)) return; // 去重
        
        seen.add(w);
        
        // 取得資訊
        const tbclLevel = tbclData[w]; // e.g. "1", "第1級"
        // 正規化 TBCL 顯示
        let levelDisplay = tbclLevel ? (tbclLevel.match(/\d+/) ? tbclLevel.match(/\d+/)[0] : tbclLevel) : null;
        
        // 取得出處 (依據當前選擇的教材)
        const sourceLesson = reverseIndex[currentSource][w];
        
        results.push({
            word: w,
            level: levelDisplay, // null 代表 TBCL 無
            source: sourceLesson // null 代表該教材無
        });
    });

    lastAnalysisResult = results;
    displayResults();
}

// 5. 顯示結果
function displayResults() {
    const container = document.getElementById('outputList');
    container.innerHTML = '';
    
    const list = lastAnalysisResult;
    
    if (!list.length) {
        container.innerHTML = '<div style="text-align:center;color:#888;margin-top:50px;">沒有生詞 (全部被過濾或無內容)</div>';
        document.getElementById('stats').innerHTML = `<span>總字數: ${document.getElementById('inputText').value.length}</span><span>生詞數: 0</span>`;
        return;
    }

    // 標籤名稱對照
    const srcLabel = currentSource === 'lai' ? '來' : '當';

    list.forEach((item, idx) => {
        const div = document.createElement('div');
        // 等級樣式 Class
        const lvlClass = item.level ? `level-${item.level}` : 'level-0';
        div.className = `vocab-item ${lvlClass}`;
        div.title = '點擊定位';
        div.onclick = (e) => {
            if (e.target.tagName === 'BUTTON') return;
            highlightWord(item.word);
        };

        // TBCL 標籤
        const tbclText = item.level ? `TBCL ${item.level}` : 'TBCL無';
        
        // 出處標籤
        const srcText = item.source ? `${srcLabel} ${item.source}` : `《${srcLabel}》無`;
        const srcClass = item.source ? '' : 'missing';

        div.innerHTML = `
            <div class="vocab-info">
                <span class="vocab-word">${idx+1}. ${item.word}</span>
                <span class="tag tag-tbcl">${tbclText}</span>
                <span class="tag tag-source ${srcClass}">${srcText}</span>
            </div>
            <div class="vocab-actions">
                <button class="action-btn" onclick="openSplitModal(${idx})">✂️</button>
                ${idx < list.length-1 ? `<button class="action-btn merge-btn" onclick="mergeWords(${idx})">🔗</button>` : ''}
            </div>
        `;
        container.appendChild(div);
    });

    document.getElementById('stats').innerHTML = `<span>總字數: ${document.getElementById('inputText').value.length}</span><span>生詞數: ${list.length}</span>`;
}

// === 輔助功能 ===

// 手動補充
window.addCustomVocab = () => {
    const val = document.getElementById('oldVocabInput').value;
    if (!val.trim()) return;
    val.split(/\s+/).forEach(w => {
        if (w.trim()) {
            customOldVocab.add(w.trim());
            knownWords.add(w.trim()); // 也要加入斷詞庫
        }
    });
    document.getElementById('oldVocabInput').value = '';
    updateCustomCount();
    if (document.getElementById('inputText').value.trim()) analyzeText();
};

window.clearCustomVocab = () => {
    customOldVocab.clear();
    updateCustomCount();
    if (document.getElementById('inputText').value.trim()) analyzeText();
};

function updateCustomCount() {
    document.getElementById('customCount').innerText = customOldVocab.size;
}

// 綠色定位
function highlightWord(word) {
    const input = document.getElementById('inputText');
    const backdrop = document.getElementById('inputBackdrop');
    const text = input.value;
    
    // 搜尋
    let idx = text.indexOf(word);
    // (這裡簡化，直接找第一個，若要循環搜尋可參考前一版)
    if (idx === -1) return;

    const pre = text.substring(0, idx);
    const target = text.substring(idx, idx + word.length);
    const post = text.substring(idx + word.length);

    backdrop.innerHTML = escapeHTML(pre) + 
        `<span class="highlight-marker">${escapeHTML(target)}</span>` + 
        escapeHTML(post) + (text.endsWith('\n') ? '<br>' : '');

    // 捲動
    const marker = backdrop.querySelector('.highlight-marker');
    if (marker) {
        input.scrollTop = marker.offsetTop - 100;
        input.focus();
        input.setSelectionRange(idx, idx);
    }
}

// 樣式同步
function initBackdropSync() {
    const input = document.getElementById('inputText');
    const backdrop = document.getElementById('inputBackdrop');
    
    const sync = () => {
        const style = window.getComputedStyle(input);
        ['fontFamily','fontSize','lineHeight','padding','border','width'].forEach(k => {
            // 簡化處理，實際需完整複製所有排版屬性
        });
        // 這裡直接用 CSS class 控制大部分樣式，JS 處理捲動
        backdrop.style.width = input.clientWidth + 'px'; // 扣除捲軸
        backdrop.scrollTop = input.scrollTop;
    };
    
    // 完整屬性同步
    const fullSync = () => {
        const s = window.getComputedStyle(input);
        backdrop.style.font = s.font;
        backdrop.style.lineHeight = s.lineHeight;
        backdrop.style.padding = s.padding;
        backdrop.style.border = s.border;
        backdrop.style.boxSizing = s.boxSizing;
        backdrop.style.width = input.clientWidth + 'px';
    };

    input.addEventListener('scroll', () => { backdrop.scrollTop = input.scrollTop; });
    input.addEventListener('input', () => { backdrop.innerHTML = ''; });
    new ResizeObserver(fullSync).observe(input);
    setTimeout(fullSync, 100);
}

// 切分與合併 (含學習機制)
window.mergeWords = (i) => {
    const l = lastAnalysisResult;
    const newWord = l[i].word + l[i+1].word;
    knownWords.add(newWord); // 學習
    // 重新分析最簡單，但為了效能可直接操作陣列
    // 這裡直接重新分析以確保過濾邏輯正確
    analyzeText(); 
};

window.openSplitModal = (i) => {
    editingIndex = i;
    document.getElementById('splitInput').value = lastAnalysisResult[i].word;
    document.getElementById('splitModal').style.display = 'block';
};
window.closeSplitModal = () => document.getElementById('splitModal').style.display = 'none';
window.confirmSplit = () => {
    const val = document.getElementById('splitInput').value;
    const parts = val.split(/\s+/).filter(x=>x);
    // 學習：移除舊詞，加入新詞
    knownWords.delete(lastAnalysisResult[editingIndex].word);
    parts.forEach(p => knownWords.add(p));
    
    closeSplitModal();
    analyzeText();
};

function naturalSort(a, b) {
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}
function escapeHTML(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function copyResults() { /* 略 */ }
function exportJSON() { /* 略 */ }