// app.js - 多教材生詞分析助手 (含出處與等級標示)

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
let knownWords = new Set();      // 斷詞參考庫 (包含所有教材詞彙，用於提升斷詞準確度)
let finalBlocklist = new Set();  // 最終過濾清單

// 反向索引：詞 -> 最早出處 (用於顯示標籤)
// 結構: { lai: { "你好": "B1" }, mtc: { "你好": "1-1" } }
let reverseIndex = { lai: {}, mtc: {} };

let editingIndex = -1;
let lastAnalysisResult = [];
let searchState = { word: '', lastIndex: -1 };

document.addEventListener('DOMContentLoaded', async () => {
    await loadAllData();
    setupEvents();
    initBackdropSync();
    
    // 初始化設定：預設使用來學華語，且不勾選任何舊詞
    setSource('lai'); 
    loadCustomVocab();
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

        console.log('所有資料載入完成');
    } catch (e) {
        console.error(e);
        alert('載入資料失敗，請確認 JSON 檔案是否存在 (learn_chinese_data.json, mtc_data.json, tbcl_data.json)');
    }
}

// 處理單一教材資料：建立斷詞參考與反向索引
function processDataSource(sourceName, data) {
    // 需要排序課別，確保找到的是「最早」出處 (例如 1-1 比 1-5 早)
    const sortedKeys = Object.keys(data).sort(naturalSort);
    
    sortedKeys.forEach(lesson => {
        const words = data[lesson];
        if (Array.isArray(words)) {
            words.forEach(w => {
                knownWords.add(w); // 加入斷詞參考，避免被切碎
                
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
    updateSelectedCount();
    
    // 如果有文字，重新分析以更新標籤 (因為出處標籤會隨教材改變)
    if (document.getElementById('inputText').value.trim()) {
        analyzeText();
    }
}

// 3. 渲染勾選清單 (分組邏輯)
function renderCheckboxes() {
    const container = document.getElementById('lessonCheckboxes');
    const controlsContainer = document.getElementById('quickControls');
    container.innerHTML = '';
    controlsContainer.innerHTML = '';

    const data = dataSources[currentSource];
    const keys = Object.keys(data).sort(naturalSort);
    
    // 分組
    const groups = {};
    const groupOrder = []; 

    keys.forEach(key => {
        let groupName = '全冊';
        // MTC: 1-1 -> 第 1 冊
        if (key.match(/^\d+-\d+/)) {
            const book = key.split('-')[0];
            groupName = `第 ${book} 冊`;
        }
        // Lai: B1 -> B1 (或者可以歸類為 "第一冊")
        else if (key.match(/^B\d+/)) {
            groupName = key;
        }

        if (!groups[groupName]) {
            groups[groupName] = [];
            groupOrder.push(groupName);
        }
        groups[groupName].push(key);
    });

    // 生成上方快速按鈕 (如果分組超過1個)
    if (groupOrder.length > 1) {
        const row = document.createElement('div');
        row.className = 'control-row';
        row.innerHTML = `<div class="control-label">📚 快速全選/取消:</div>`;
        
        groupOrder.forEach(gName => {
            const btn = document.createElement('button');
            btn.className = 'btn-secondary btn-xs';
            btn.innerText = gName;
            btn.onclick = () => toggleGroup(gName, groups[gName]);
            row.appendChild(btn);
        });
        
        const clearBtn = document.createElement('button');
        clearBtn.className = 'btn-secondary btn-xs';
        clearBtn.style.color = '#e53e3e';
        clearBtn.innerText = '全部清空';
        clearBtn.onclick = () => {
            const prefix = currentSource + ':';
            const toRemove = [];
            selectedLessons.forEach(k => { if (k.startsWith(prefix)) toRemove.push(k); });
            toRemove.forEach(k => selectedLessons.delete(k));
            renderCheckboxes();
            updateBlocklist();
        };
        row.appendChild(clearBtn);
        controlsContainer.appendChild(row);
    }

    // 生成詳細列表
    groupOrder.forEach(gName => {
        const subKeys = groups[gName];
        const groupDiv = document.createElement('div');
        groupDiv.className = 'book-group';

        const header = document.createElement('div');
        header.className = 'book-header';
        
        const masterCb = document.createElement('input');
        masterCb.type = 'checkbox';
        
        const prefix = currentSource + ':';
        const allSelected = subKeys.every(k => selectedLessons.has(prefix + k));
        const someSelected = subKeys.some(k => selectedLessons.has(prefix + k));
        masterCb.checked = allSelected && subKeys.length > 0;
        masterCb.indeterminate = someSelected && !allSelected;

        masterCb.onclick = (e) => {
            e.stopPropagation();
            const checked = e.target.checked;
            subKeys.forEach(k => {
                const fullKey = prefix + k;
                if (checked) selectedLessons.add(fullKey);
                else selectedLessons.delete(fullKey);
            });
            renderCheckboxes();
            updateBlocklist();
        };

        const title = document.createElement('span');
        let titleText = gName;
        // 如果是 B1 這種單一群組，顯示詞數；如果是多課群組，顯示課數
        if (subKeys.length === 1 && subKeys[0] === gName) {
             const count = data[gName].length;
             titleText += ` (${count} 詞)`;
        } else {
             titleText += ` (${subKeys.length} 課)`;
        }
        title.innerHTML = `&nbsp; ${titleText}`;
        
        const arrow = document.createElement('span');
        arrow.textContent = '▼';
        arrow.style.marginLeft = 'auto';

        header.append(masterCb, title, arrow);
        
        const content = document.createElement('div');
        content.className = 'book-content';
        
        // MTC 預設展開第一冊
        if (groupOrder.indexOf(gName) === 0) {
            content.classList.add('open');
            arrow.textContent = '▲';
        }

        header.onclick = (e) => {
            if (e.target.type === 'checkbox') return;
            content.classList.toggle('open');
            arrow.textContent = content.classList.contains('open') ? '▲' : '▼';
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
            groupDiv.append(header);
        }
        
        container.append(groupDiv);
    });
    
    updateSelectedCount();
}

function toggleGroup(gName, keys) {
    const prefix = currentSource + ':';
    const allSelected = keys.every(k => selectedLessons.has(prefix + k));
    const newState = !allSelected;

    keys.forEach(k => {
        const fullKey = prefix + k;
        if (newState) selectedLessons.add(fullKey);
        else selectedLessons.delete(fullKey);
    });

    renderCheckboxes();
    updateBlocklist();
}

function toggleLesson(fullKey) {
    if (selectedLessons.has(fullKey)) selectedLessons.delete(fullKey);
    else selectedLessons.add(fullKey);
    renderCheckboxes();
    updateBlocklist();
}

function updateSelectedCount() {
    const prefix = currentSource + ':';
    let count = 0;
    selectedLessons.forEach(k => { if (k.startsWith(prefix)) count++; });
    document.getElementById('selectedCount').innerText = count;
}

// 更新過濾清單 (重要修正)
function updateBlocklist() {
    finalBlocklist.clear();
    
    // 遍歷所有選取的課程代號 (例如 "mtc:1-1", "lai:B1")
    selectedLessons.forEach(fullKey => {
        const [source, key] = fullKey.split(':');
        if (dataSources[source] && dataSources[source][key]) {
            dataSources[source][key].forEach(w => finalBlocklist.add(w));
        }
    });
    
    customVocab.forEach(w => finalBlocklist.add(w));
    
    document.getElementById('totalBlockedCount').innerText = finalBlocklist.size;
    updateSelectedCount();
}

// 4. 分析核心
function analyzeText() {
    const text = document.getElementById('inputText').value;
    if (!text.trim()) return;

    // 清空背景
    document.getElementById('inputBackdrop').innerHTML = '';

    // 更新過濾清單
    updateBlocklist();

    // 斷詞
    let words = [];
    const useAdvanced = document.getElementById('useAdvancedSegmenter').checked;
    const useGrammar = document.getElementById('useGrammarRules').checked;
    
    const segmentDict = { ...tbclData };
    knownWords.forEach(w => { if (!segmentDict[w]) segmentDict[w] = '0'; });
    
    if (useAdvanced && typeof advancedSegment !== 'undefined') {
        words = advancedSegment(text, segmentDict, finalBlocklist, true, useGrammar);
    } else {
        const segmenter = new Intl.Segmenter('zh-TW', { granularity: 'word' });
        words = Array.from(segmenter.segment(text)).map(s => s.segment);
    }

    // 過濾與標註
    const results = [];
    const seen = new Set();

    words.forEach(w => {
        if (/^[^\w\u4e00-\u9fa5]+$/.test(w) || !w.trim()) return; // 跳過標點
        if (finalBlocklist.has(w)) return; // 過濾舊詞
        if (seen.has(w)) return; // 去重
        
        seen.add(w);
        
        // 取得資訊
        const tbclLevel = tbclData[w]; 
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

        const mergeBtn = idx < list.length - 1 ? 
            `<button class="action-btn merge-btn" onclick="mergeWords(${idx})">🔗</button>` : '';

        div.innerHTML = `
            <div class="vocab-info">
                <span class="vocab-word">${idx+1}. ${item.word}</span>
                <span class="tag tag-tbcl">${tbclText}</span>
                <span class="tag tag-source ${srcClass}">${srcText}</span>
            </div>
            <div class="vocab-actions">
                <button class="action-btn" onclick="openSplitModal(${idx})">✂️</button>
                ${mergeBtn}
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
            customVocab.add(w.trim());
            knownWords.add(w.trim()); // 也要加入斷詞庫
        }
    });
    document.getElementById('oldVocabInput').value = '';
    updateCustomCount();
    if (document.getElementById('inputText').value.trim()) analyzeText();
};

window.clearCustomVocab = () => {
    customVocab.clear();
    updateCustomCount();
    if (document.getElementById('inputText').value.trim()) analyzeText();
};

function updateCustomCount() {
    document.getElementById('customCount').innerText = customVocab.size;
}

// 綠色定位
function highlightWord(word) {
    const input = document.getElementById('inputText');
    const backdrop = document.getElementById('inputBackdrop');
    const text = input.value;
    
    // 搜尋
    let idx = text.indexOf(word);
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
        // 將 highlight 元素捲動到可視區域中央
        const inputRect = input.getBoundingClientRect();
        const markerRect = marker.getBoundingClientRect();
        // 這邊需要一點技巧，因為 backdrop 是絕對定位且與 input 同步捲動
        // 最簡單的方法是直接計算 offsetTop
        input.scrollTop = marker.offsetTop - (input.clientHeight / 2) + (marker.offsetHeight / 2);
        input.focus();
        input.setSelectionRange(idx, idx);
    }
}

// 樣式同步
function initBackdropSync() {
    const input = document.getElementById('inputText');
    const backdrop = document.getElementById('inputBackdrop');
    
    const syncStyles = () => {
        const style = window.getComputedStyle(input);
        const props = [
            'fontFamily', 'fontSize', 'lineHeight', 'letterSpacing', 'wordSpacing',
            'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight',
            'borderTopWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderRightWidth',
            'boxSizing', 'width'
        ];
        props.forEach(p => backdrop.style[p] = style[p]);
        // 確保寬度扣除捲軸
        backdrop.style.width = input.clientWidth + 'px';
    };

    const syncScroll = () => {
        backdrop.scrollTop = input.scrollTop;
        backdrop.scrollLeft = input.scrollLeft;
    };

    input.addEventListener('scroll', syncScroll);
    input.addEventListener('input', () => {
        backdrop.innerHTML = '';
        syncScroll();
    });
    
    new ResizeObserver(() => {
        syncStyles();
        syncScroll();
    }).observe(input);
    setTimeout(syncStyles, 100);
}

function setupEvents() {
    document.getElementById('analyzeBtn').onclick = analyzeText;
    document.getElementById('clearBtn').onclick = () => {
        document.getElementById('inputText').value = '';
        document.getElementById('outputList').innerHTML = '';
        document.getElementById('stats').innerHTML = '<span>總字數: 0</span><span>生詞數: 0</span>';
        document.getElementById('inputBackdrop').innerHTML = '';
        lastAnalysisResult = [];
    };
    
    // Copy & Export
    document.getElementById('copyBtn').onclick = () => {
        if (!lastAnalysisResult.length) return;
        const t = lastAnalysisResult.map((i,idx)=>`${idx+1}. ${i.word} (TBCL: ${i.level||'-'}, Source: ${i.source||'-'})`).join('\n');
        navigator.clipboard.writeText(t).then(()=>alert('已複製'));
    };
    document.getElementById('exportBtn').onclick = () => {
        if (!lastAnalysisResult.length) return;
        const b = new Blob([JSON.stringify(lastAnalysisResult,null,2)],{type:'application/json'});
        const a = document.createElement('a');
        a.href = URL.createObjectURL(b);
        a.download = 'vocab.json';
        a.click();
    };
    
    document.getElementById('splitInput').addEventListener('keypress', function (e) {
        if (e.key === 'Enter') confirmSplit();
    });
}

// 切分與合併 (含學習機制)
window.mergeWords = (i) => {
    const l = lastAnalysisResult;
    const newWord = l[i].word + l[i+1].word;
    knownWords.add(newWord); 
    analyzeText(); 
};

window.openSplitModal = (i) => {
    editingIndex = i;
    document.getElementById('splitInput').value = lastAnalysisResult[i].word;
    document.getElementById('splitModal').style.display = 'block';
    setTimeout(()=>document.getElementById('splitInput').focus(), 100);
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
function loadCustomVocab() { /* 保持不變 */ }