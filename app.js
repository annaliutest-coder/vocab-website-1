// app.js - 多教材生詞分析助手 (修正過濾、新增標籤)

let tbclData = {};
let dataSources = {
    lai: {}, // 來學華語
    mtc: {}  // 當代中文
};
let currentSource = 'lai'; // 當前選擇的教材

let selectedLessons = new Set(); // 格式: "lai:B1" 或 "mtc:1-1"
let customVocab = new Set();     // 手動補充
let knownWords = new Set(["紅色", "護龍", "還都", "看書", "吃飯", "一定", "因為", "大家", "讓"]); // 斷詞參考
let finalBlocklist = new Set();  // 最終過濾清單

// 反向索引：詞 -> 最早出處
let reverseIndex = { lai: {}, mtc: {} };

let editingIndex = -1;
let lastAnalysisResult = [];
let searchState = { word: '', lastIndex: -1 };

document.addEventListener('DOMContentLoaded', async () => {
    await loadAllData();
    setupEvents();
    initBackdropSync();
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
        alert('載入資料失敗，請確認 JSON 檔案是否存在');
    }
}

function processDataSource(sourceName, data) {
    const sortedKeys = Object.keys(data).sort(naturalSort);
    sortedKeys.forEach(lesson => {
        const words = data[lesson];
        if (Array.isArray(words)) {
            words.forEach(w => {
                knownWords.add(w); 
                // 記錄最早出處
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
    
    document.querySelectorAll('.source-btn').forEach(btn => btn.classList.remove('active'));
    const activeBtnText = source === 'lai' ? '來學華語' : '當代中文';
    Array.from(document.querySelectorAll('.source-btn'))
         .find(b => b.textContent.includes(activeBtnText))
         ?.classList.add('active');

    renderCheckboxes();
    updateSelectedCount();
    
    // 重新分析以更新標籤
    if (document.getElementById('inputText').value.trim()) {
        analyzeText();
    }
}

// 3. 渲染勾選清單
function renderCheckboxes() {
    const container = document.getElementById('lessonCheckboxes');
    const controlsContainer = document.getElementById('quickControls');
    container.innerHTML = '';
    controlsContainer.innerHTML = '';

    const data = dataSources[currentSource];
    if (!data) return;

    const keys = Object.keys(data).sort(naturalSort);
    const groups = {};
    const groupOrder = []; 

    keys.forEach(key => {
        let groupName = '全冊';
        if (key.match(/^\d+-\d+/)) { // MTC 1-1 -> 第 1 冊
            const book = key.split('-')[0];
            groupName = `第 ${book} 冊`;
        } else if (key.match(/^B\d+/)) { // Lai B1 -> B1
            groupName = key;
        }

        if (!groups[groupName]) {
            groups[groupName] = [];
            groupOrder.push(groupName);
        }
        groups[groupName].push(key);
    });

    // 快速按鈕
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

    // 生成列表
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
        if (gName.includes('第 1 冊') || gName === 'B1') {
            content.classList.add('open');
            arrow.textContent = '▲';
        }

        header.onclick = (e) => {
            if (e.target.type === 'checkbox') return;
            content.classList.toggle('open');
            arrow.textContent = content.classList.contains('open') ? '▲' : '▼';
        };

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

// 快速切換群組
window.toggleGroup = function(gName, keys) {
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

// 更新過濾清單 (重要!)
function updateBlocklist() {
    finalBlocklist.clear();
    
    selectedLessons.forEach(fullKey => {
        const [source, key] = fullKey.split(':');
        if (dataSources[source] && dataSources[source][key]) {
            dataSources[source][key].forEach(w => finalBlocklist.add(w));
        }
    });
    
    customVocab.forEach(w => finalBlocklist.add(w));
    
    document.getElementById('totalBlockedCount').innerText = finalBlocklist.size;
    
    // 如果有文字，自動重新分析 (即時反應)
    if (document.getElementById('inputText').value.trim()) {
        analyzeText();
    }
}

// 4. 分析核心
function analyzeText() {
    const text = document.getElementById('inputText').value;
    if (!text.trim()) return;

    document.getElementById('inputBackdrop').innerHTML = '';
    searchState = { word: '', lastIndex: -1 };

    // 斷詞
    let words = [];
    // 雖然這裡不使用 advancedSegment 參數，但保留擴充性
    const segmentDict = { ...tbclData };
    knownWords.forEach(w => { if (!segmentDict[w]) segmentDict[w] = '0'; });
    
    if (typeof advancedSegment !== 'undefined') {
        // 使用 finalBlocklist 作為已知詞的一部分，防止切碎舊詞
        words = advancedSegment(text, segmentDict, finalBlocklist, true, true);
    } else {
        const segmenter = new Intl.Segmenter('zh-TW', { granularity: 'word' });
        words = Array.from(segmenter.segment(text)).map(s => s.segment);
    }

    // 過濾與標註
    const results = [];
    const seen = new Set();

    words.forEach(w => {
        if (/^[^\w\u4e00-\u9fa5]+$/.test(w) || !w.trim()) return; 
        if (finalBlocklist.has(w)) return; // 過濾
        if (seen.has(w)) return; 
        
        seen.add(w);
        
        // TBCL
        const tbclLevel = tbclData[w]; 
        let levelDisplay = tbclLevel ? (tbclLevel.match(/\d+/) ? tbclLevel.match(/\d+/)[0] : tbclLevel) : null;
        
        // 出處
        const sourceLesson = reverseIndex[currentSource][w];
        
        results.push({
            word: w,
            level: levelDisplay, 
            source: sourceLesson
        });
    });

    lastAnalysisResult = results;
    displayResults();
}

// 5. 顯示結果 (含標籤)
function displayResults() {
    const container = document.getElementById('outputList');
    container.innerHTML = '';
    
    const list = lastAnalysisResult;
    
    if (!list.length) {
        container.innerHTML = '<div style="text-align:center;color:#888;margin-top:50px;">沒有生詞 (全部被過濾或無內容)</div>';
        document.getElementById('stats').innerHTML = `<span>總字數: ${document.getElementById('inputText').value.length}</span><span>生詞數: 0</span>`;
        return;
    }

    const srcLabel = currentSource === 'lai' ? '來' : '當';

    list.forEach((item, idx) => {
        const div = document.createElement('div');
        const lvlClass = item.level ? `level-${item.level}` : 'level-0';
        div.className = `vocab-item ${lvlClass}`;
        div.title = '點擊定位';
        div.onclick = (e) => {
            if (e.target.tagName === 'BUTTON') return;
            highlightWordInInput(item.word);
        };

        const tbclText = item.level ? `TBCL ${item.level}` : 'TBCL無';
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

// 輔助功能
window.addCustomVocab = () => {
    const val = document.getElementById('oldVocabInput').value;
    if (!val.trim()) return;
    val.split(/\s+/).forEach(w => {
        if (w.trim()) {
            customVocab.add(w.trim());
            knownWords.add(w.trim());
        }
    });
    document.getElementById('oldVocabInput').value = '';
    updateBlocklist();
};

window.clearCustomVocab = () => {
    customVocab.clear();
    updateBlocklist();
};

// 綠色定位
function highlightWordInInput(word) {
    const input = document.getElementById('inputText');
    const backdrop = document.getElementById('inputBackdrop');
    if (!input || !word) return;

    const text = input.value;
    
    if (searchState.word !== word) {
        searchState.word = word;
        searchState.lastIndex = -1;
    }

    let index = text.indexOf(word, searchState.lastIndex + 1);
    if (index === -1) {
        index = text.indexOf(word, 0); 
        if (index === -1) { alert(`在原文中找不到「${word}」`); return; }
    }
    
    searchState.lastIndex = index;

    const before = text.substring(0, index);
    const target = text.substring(index, index + word.length);
    const after = text.substring(index + word.length);
    const highlightMarker = `<span class="highlight-marker">${escapeHTML(target)}</span>`;
    let htmlContent = escapeHTML(before) + highlightMarker + escapeHTML(after);
    if (text.endsWith('\n')) htmlContent += '<br>';
    backdrop.innerHTML = htmlContent;

    const marker = backdrop.querySelector('.highlight-marker');
    if (marker) {
        const offsetTop = marker.offsetTop;
        const scrollTarget = offsetTop - (input.clientHeight / 2) + (marker.offsetHeight / 2);
        input.scrollTop = scrollTarget;
        input.focus(); 
        input.setSelectionRange(index, index);
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
    
    document.getElementById('copyBtn').onclick = () => {
        if (!lastAnalysisResult.length) return;
        const t = lastAnalysisResult.map((i,idx)=>`${idx+1}. ${i.word}`).join('\n');
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

// 切分與合併
window.mergeWords = (i) => {
    const l = lastAnalysisResult;
    const w = l[i].word + l[i+1].word;
    knownWords.add(w); 
    if (finalBlocklist.has(w)) l.splice(i, 2); 
    else l.splice(i, 2, { word: w, level: tbclData[w] || null, source: reverseIndex[currentSource][w] });
    displayResults();
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
    
    knownWords.delete(lastAnalysisResult[editingIndex].word);
    parts.forEach(p => knownWords.add(p));
    
    const ins = [];
    parts.forEach(w => {
        if (!finalBlocklist.has(w)) { 
            ins.push({ 
                word: w, 
                level: tbclData[w] ? (tbclData[w].match(/\d+/) ? tbclData[w].match(/\d+/)[0] : tbclData[w]) : null,
                source: reverseIndex[currentSource][w]
            });
        }
    });
    
    lastAnalysisResult.splice(editingIndex, 1, ...ins);
    displayResults();
    closeSplitModal();
};

function naturalSort(a, b) {
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}
function escapeHTML(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function loadCustomVocab() { /* 如前 */ }