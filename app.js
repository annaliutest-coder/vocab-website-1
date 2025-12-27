// app.js - 網站版生詞分析助手（雙教材切換版）

let tbclData = {};
let sourcesData = {
    lai: {}, // 來學華語
    mtc: {}  // 當代中文課程
};
let currentSource = 'lai'; // 當前選擇的教材
let customOldVocab = new Set();
let selectedLessons = new Set(); // 格式: "lai:B1" 或 "mtc:1-1" (加上前綴以區分)
let finalBlocklist = new Set();

// 斷詞提示庫 (包含所有已載入教材的詞彙)
let knownWords = new Set(["紅色", "護龍", "還都", "看書", "吃飯", "一定", "因為", "大家", "讓"]); 

let editingIndex = -1;
let searchState = { word: '', lastIndex: -1 };

document.addEventListener('DOMContentLoaded', async () => {
  await loadData();
  setupEventListeners();
  initBackdropSync();
  loadCustomVocab();
  // 初始渲染
  switchSource('lai'); 
});

async function loadData() {
  try {
    // 1. 載入 TBCL
    const tbclRes = await fetch('tbcl_data.json');
    tbclData = await tbclRes.json();

    // 2. 載入 來學華語
    const laiRes = await fetch('learn_chinese_data.json');
    sourcesData.lai = await laiRes.json();

    // 3. 載入 當代中文課程
    const mtcRes = await fetch('mtc_data.json');
    sourcesData.mtc = await mtcRes.json();
    
    // 將所有教材的詞彙加入 knownWords 以優化斷詞
    [sourcesData.lai, sourcesData.mtc].forEach(data => {
        Object.values(data).forEach(wordList => {
            if (Array.isArray(wordList)) {
                wordList.forEach(w => knownWords.add(w));
            }
        });
    });

    console.log('所有資料載入完成');
  } catch (error) {
    console.error('載入失敗:', error);
    alert('載入資料失敗，請確認 JSON 檔案是否存在 (learn_chinese_data.json, mtc_data.json)');
  }
}

// === 切換教材 ===
window.switchSource = function(source) {
    currentSource = source;
    
    // 更新按鈕樣式
    document.querySelectorAll('.source-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.innerText.includes(source === 'lai' ? '來學華語' : '當代中文')) {
            btn.classList.add('active');
        }
    });

    renderLessonCheckboxes();
    updateBlocklist(); // 切換後重新計算過濾清單
}

// === 渲染課程勾選區 (支援動態結構) ===
function renderLessonCheckboxes() {
    const container = document.getElementById('lessonCheckboxes');
    const controlsContainer = document.getElementById('quickControls');
    container.innerHTML = '';
    controlsContainer.innerHTML = '';

    const data = sourcesData[currentSource];
    const keys = Object.keys(data).sort(naturalSort); // 自然排序 (1-2, 1-10)

    // 分析資料結構來決定如何分組
    // 如果 key 是 "B1", "B2" -> 視為冊別，直接列表
    // 如果 key 是 "1-1", "1-2" -> 解析出冊別，進行分組
    
    const groups = {};
    const groupOrder = [];

    keys.forEach(key => {
        let groupName = '全冊';
        
        // 嘗試解析 MTC 格式 "1-1" -> Book 1
        if (key.match(/^\d+-\d+$/)) {
            const bookNum = key.split('-')[0];
            groupName = `第 ${bookNum} 冊`;
        } 
        // 嘗試解析 Lai 格式 "B1", "B2"
        else if (key.match(/^B\d+/)) {
            // 來學華語目前 json 結構若是 "B1", 其實它本身就是一冊
            // 我們可以把它當作單獨的項目，或者如果您希望 B1 裡面還有 L1, L2...
            // 根據您提供的檔案，目前是用 B1, B2... 當 Key
            groupName = key; // 直接用 B1 當群組名，內容就是 B1 的詞
        }

        if (!groups[groupName]) {
            groups[groupName] = [];
            groupOrder.push(groupName);
        }
        groups[groupName].push(key);
    });

    // 1. 生成上方快速按鈕 (針對 MTC 這種多冊的)
    if (groupOrder.length > 1) {
        const row = document.createElement('div');
        row.className = 'control-row';
        row.innerHTML = `<div class="control-label">📚 快速全選/取消:</div>`;
        
        groupOrder.forEach(gName => {
            const btn = document.createElement('button');
            btn.className = 'btn-secondary btn-xs';
            btn.innerText = gName;
            btn.onclick = () => toggleGroup(gName, true); // 簡易 toggle，稍後實作
            row.appendChild(btn);
        });
        
        // 清空按鈕
        const clearBtn = document.createElement('button');
        clearBtn.className = 'btn-secondary btn-xs';
        clearBtn.style.color = '#e53e3e';
        clearBtn.innerText = '全部清空';
        clearBtn.onclick = () => {
            // 清除當前 source 的所有選取
            const prefix = currentSource + ':';
            // 使用 Array.from 避免迭代時刪除的問題
            Array.from(selectedLessons).forEach(k => {
                if (k.startsWith(prefix)) selectedLessons.delete(k);
            });
            renderLessonCheckboxes(); // 重繪以更新勾選狀態
            updateBlocklist();
        };
        row.appendChild(clearBtn);
        
        controlsContainer.appendChild(row);
    }

    // 2. 生成詳細列表
    groupOrder.forEach(gName => {
        const subKeys = groups[gName];
        
        const groupDiv = document.createElement('div');
        groupDiv.className = 'book-group';
        
        const header = document.createElement('div');
        header.className = 'book-header';
        
        // 全選該組的 checkbox
        const masterCb = document.createElement('input');
        masterCb.type = 'checkbox';
        masterCb.className = 'book-master-cb';
        masterCb.dataset.group = gName;
        
        // 檢查該組是否全選
        const prefix = currentSource + ':';
        const allSelected = subKeys.every(k => selectedLessons.has(prefix + k));
        const someSelected = subKeys.some(k => selectedLessons.has(prefix + k));
        masterCb.checked = allSelected;
        masterCb.indeterminate = someSelected && !allSelected;

        masterCb.onclick = (e) => {
            e.stopPropagation();
            const checked = e.target.checked;
            subKeys.forEach(k => {
                const fullKey = prefix + k;
                if (checked) selectedLessons.add(fullKey);
                else selectedLessons.delete(fullKey);
            });
            renderLessonCheckboxes(); // 重繪更新狀態
            updateBlocklist();
        };

        const title = document.createElement('span');
        // 如果 groupName 和 key 一樣 (例如來學華語 B1)，顯示內容詞數
        let displayTitle = gName;
        if (subKeys.length === 1 && subKeys[0] === gName) {
             const count = sourcesData[currentSource][gName]?.length || 0;
             displayTitle += ` (${count} 詞)`;
        } else {
             displayTitle += ` (${subKeys.length} 課)`;
        }
        
        title.innerHTML = `&nbsp; ${displayTitle}`;
        
        const arrow = document.createElement('span');
        arrow.textContent = '▼';
        arrow.style.marginLeft = 'auto';

        header.append(masterCb, title, arrow);
        
        // 內容區
        const content = document.createElement('div');
        content.className = 'book-content';
        // 預設展開第一冊
        if (groupOrder.indexOf(gName) === 0) {
            content.classList.add('open');
            arrow.textContent = '▲';
        }

        header.onclick = (e) => {
            if (e.target.type === 'checkbox') return;
            content.classList.toggle('open');
            arrow.textContent = content.classList.contains('open') ? '▲' : '▼';
        };

        // 如果該組只有一個項目且名稱相同 (例如來學華語 B1)，就不需要展開內容了，直接用標題控制即可
        // 但為了統一，我們還是列出來，或者隱藏 content 保留結構
        if (!(subKeys.length === 1 && subKeys[0] === gName)) {
            subKeys.forEach(key => {
                const lbl = document.createElement('label');
                lbl.className = 'checkbox-item';
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.value = key;
                cb.checked = selectedLessons.has(prefix + key);
                cb.onchange = () => {
                    const fullKey = prefix + key;
                    if (cb.checked) selectedLessons.add(fullKey);
                    else selectedLessons.delete(fullKey);
                    updateBlocklist();
                    // 更新 master checkbox 狀態 (簡易做法：重繪 master)
                    const newAll = subKeys.every(k => selectedLessons.has(prefix + k));
                    const newSome = subKeys.some(k => selectedLessons.has(prefix + k));
                    masterCb.checked = newAll;
                    masterCb.indeterminate = newSome && !newAll;
                };
                lbl.append(cb, key);
                content.appendChild(lbl);
            });
            groupDiv.append(header, content);
        } else {
            // 單一項目模式 (Header 直接控制)
            // 這裡不需要 content，Header 的 checkbox 已經足夠控制
            // 但為了讓視覺一致，我們保留 header
            groupDiv.append(header);
        }

        container.appendChild(groupDiv);
    });
    
    updateSelectedCountUI();
}

// 輔助：自然排序 (讓 1-2 排在 1-10 前面)
function naturalSort(a, b) {
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

// 快速切換群組 (上方按鈕)
window.toggleGroup = function(gName, forceState) {
    // 找出該群組的所有 keys
    const data = sourcesData[currentSource];
    const keys = Object.keys(data).filter(k => {
        if (gName.startsWith('第')) {
            // MTC: "第 1 冊" -> match "1-1", "1-2"
            const bookNum = gName.match(/\d+/)[0];
            return k.startsWith(bookNum + '-');
        } else {
            // Lai: "B1" -> match "B1"
            return k === gName;
        }
    });

    const prefix = currentSource + ':';
    // 檢查目前是否全選，如果是則全取消，否則全選
    const allSelected = keys.every(k => selectedLessons.has(prefix + k));
    const newState = !allSelected;

    keys.forEach(k => {
        const fullKey = prefix + k;
        if (newState) selectedLessons.add(fullKey);
        else selectedLessons.delete(fullKey);
    });

    renderLessonCheckboxes();
    updateBlocklist();
}

function updateSelectedCountUI() {
    document.getElementById('selectedLessonCount').innerText = selectedLessons.size;
}

function updateBlocklist() {
    finalBlocklist.clear();
    
    // 遍歷所有選取的課程代號 (例如 "mtc:1-1", "lai:B1")
    selectedLessons.forEach(fullKey => {
        const [source, key] = fullKey.split(':');
        if (sourcesData[source] && sourcesData[source][key]) {
            const words = sourcesData[source][key];
            words.forEach(w => finalBlocklist.add(w));
        }
    });
    
    customOldVocab.forEach(w => finalBlocklist.add(w));
    
    document.getElementById('totalBlockedCount').innerText = finalBlocklist.size;
    updateSelectedCountUI();
}

// === 其他原有功能保持不變 ===

function initBackdropSync() {
    const input = document.getElementById('inputText');
    const backdrop = document.getElementById('inputBackdrop');
    
    const syncStyles = () => {
        const style = window.getComputedStyle(input);
        const props = [
            'fontFamily', 'fontSize', 'lineHeight', 'letterSpacing', 'wordSpacing',
            'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight',
            'borderTopWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderRightWidth',
            'boxSizing'
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
        if (index === -1) {
            alert(`在原文中找不到「${word}」`);
            return;
        }
    }
    
    searchState.lastIndex = index;

    const before = text.substring(0, index);
    const target = text.substring(index, index + word.length);
    const after = text.substring(index + word.length);

    const highlightMarker = `<span class="highlight-marker">${escapeHTML(target)}</span>`;

    let htmlContent = escapeHTML(before) + highlightMarker + escapeHTML(after);
    if (text.endsWith('\n')) {
        htmlContent += '<br>'; 
    }

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

function escapeHTML(text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
               .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function loadCustomVocab() {
    const stored = localStorage.getItem('customOldVocab');
    if (stored) {
        const list = JSON.parse(stored);
        list.forEach(w => customOldVocab.add(w));
    }
}

function saveCustomVocab() {
    localStorage.setItem('customOldVocab', JSON.stringify([...customOldVocab]));
    updateBlocklist();
}

function setupEventListeners() {
  document.getElementById('analyzeBtn').onclick = analyzeText;
  document.getElementById('clearBtn').onclick = () => {
      document.getElementById('inputText').value = '';
      document.getElementById('outputList').innerHTML = '';
      document.getElementById('stats').innerHTML = '<span>總字數: 0</span><span>生詞數: 0</span>';
      document.getElementById('inputBackdrop').innerHTML = '';
      window.lastAnalysis = [];
  };
  
  document.getElementById('addOldVocabBtn').addEventListener('click', () => {
    const input = document.getElementById('oldVocabInput');
    const text = input.value.trim();
    if (!text) return;

    const words = text.split(/[\n,、\s]+/).map(w => w.trim()).filter(w => w);
    let addedCount = 0;
    words.forEach(w => {
        if (!customOldVocab.has(w)) {
            customOldVocab.add(w);
            addedCount++;
        }
    });

    saveCustomVocab();
    input.value = '';
    showStatus(`已新增 ${addedCount} 個補充舊詞`, 'success');
    
    if (document.getElementById('inputText').value.trim()) {
        analyzeText(); 
    }
  });

  document.getElementById('showOldVocabBtn').addEventListener('click', () => {
    const list = [...customOldVocab].sort((a, b) => a.localeCompare(b, 'zh-TW'));
    document.getElementById('oldVocabInput').value = list.join('\n');
    showStatus(`目前有 ${list.length} 個補充舊詞`, 'info');
  });
  
  document.getElementById('clearOldVocabBtn').addEventListener('click', () => {
    if(confirm('確定要清除所有「手動補充」的舊詞嗎？(不會影響勾選的課本詞彙)')) {
        customOldVocab.clear();
        saveCustomVocab();
        document.getElementById('oldVocabInput').value = '';
        showStatus('已清除補充舊詞', 'success');
        if (document.getElementById('inputText').value.trim()) {
            analyzeText(); 
        }
    }
  });

  document.getElementById('copyBtn').onclick = () => {
      if (!window.lastAnalysis?.length) return;
      const t = window.lastAnalysis.map((i,idx)=>`${idx+1}. ${i.word} (Level ${i.level})`).join('\n');
      navigator.clipboard.writeText(t).then(()=>alert('已複製'));
  };
  document.getElementById('exportBtn').onclick = () => {
      if (!window.lastAnalysis?.length) return;
      const b = new Blob([JSON.stringify(window.lastAnalysis,null,2)],{type:'application/json'});
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = 'vocab.json';
      a.click();
  };
  
  document.getElementById('splitInput').addEventListener('keypress', function (e) {
    if (e.key === 'Enter') {
      confirmSplit();
    }
  });
}

function analyzeText() {
  const text = document.getElementById('inputText').value;
  if (!text.trim()) { 
      return; 
  }
  
  document.getElementById('inputBackdrop').innerHTML = '';
  searchState = { word: '', lastIndex: -1 };

  const useAdvanced = document.getElementById('useAdvancedSegmenter').checked;
  const useGrammar = document.getElementById('useGrammarRules').checked;

  let words = [];
  if (useAdvanced && typeof advancedSegment !== 'undefined') {
      const dict = { ...tbclData };
      knownWords.forEach(w => { if (!dict[w]) dict[w] = '0'; });
      words = advancedSegment(text, dict, finalBlocklist, true, useGrammar);
  } else {
      const segmenter = new Intl.Segmenter('zh-TW', { granularity: 'word' });
      words = Array.from(segmenter.segment(text)).map(s => s.segment);
  }

  const results = [];
  const uniq = new Set();
  words.forEach(w => {
      if (/^[。，、；：！？「」『』（）《》…—\s\d\w]+$/.test(w) || !w.trim()) return;
      if (finalBlocklist.has(w)) return; // 過濾舊詞
      if (uniq.has(w)) return;
      uniq.add(w);
      results.push({ word: w, level: tbclData[w] || '0' });
  });

  window.lastAnalysis = results;
  displayResults();
}

function displayResults() {
  const list = window.lastAnalysis || [];
  const container = document.getElementById('outputList');
  container.innerHTML = '';
  
  if (!list.length) {
      container.innerHTML = '<div style="text-align:center;color:#888;margin-top:50px;">沒有發現生詞！(全都是舊詞或已知詞彙)</div>';
      return;
  }

  list.forEach((item, idx) => {
      const div = document.createElement('div');
      div.className = `vocab-item level-${item.level}`;
      div.style.cursor = 'pointer';
      div.title = '點擊在文章中定位';
      div.onclick = (e) => {
          if (e.target.tagName === 'BUTTON') return;
          highlightWordInInput(item.word);
      };

      const mergeBtn = idx < list.length - 1 ? 
          `<button class="action-btn merge-btn" onclick="mergeWithNext(${idx})">🔗 合併</button>` : '';

      div.innerHTML = `
        <div class="vocab-info">
            <span style="font-weight:bold;font-size:18px;">${idx+1}. ${item.word}</span>
            <span class="level-tag">${item.level === '0' ? '未知' : 'Level '+item.level}</span>
        </div>
        <div class="vocab-actions">
            <button class="action-btn" onclick="openSplitModal(${idx})">✂️ 切分</button>
            ${mergeBtn}
        </div>`;
      container.appendChild(div);
  });
  
  document.getElementById('stats').innerHTML = `<span>總字數: ${document.getElementById('inputText').value.length}</span><span>生詞數: ${list.length}</span>`;
}

// 合併與切分後，必須再次過濾掉 blocklist 中的詞
window.mergeWithNext = function(i) {
    const l = window.lastAnalysis;
    const w = l[i].word + l[i+1].word;
    
    // 檢查合併後的詞是否在避開清單中
    if (finalBlocklist.has(w)) {
        l.splice(i, 2); 
    } else {
        l.splice(i, 2, { word: w, level: tbclData[w] || '0' });
    }
    displayResults();
};

window.openSplitModal = function(i) {
    editingIndex = i;
    document.getElementById('splitInput').value = window.lastAnalysis[i].word;
    document.getElementById('splitModal').style.display = 'block';
    setTimeout(()=>document.getElementById('splitInput').focus(), 100);
};
window.closeSplitModal = () => { document.getElementById('splitModal').style.display = 'none'; editingIndex = -1; };

window.confirmSplit = () => {
    if (editingIndex === -1) return;
    const val = document.getElementById('splitInput').value;
    if (!val.trim()) { closeSplitModal(); return; }
    
    const newW = val.split(/\s+/).filter(x=>x.trim());
    if (newW.join('') !== window.lastAnalysis[editingIndex].word) {
        if (!confirm('文字不符，確定修改？')) return;
    }
    
    // 過濾掉切分後屬於舊詞的部分
    const ins = [];
    newW.forEach(w => {
        if (!finalBlocklist.has(w)) { 
            ins.push({ word: w, level: tbclData[w] || '0' });
        }
    });
    
    window.lastAnalysis.splice(editingIndex, 1, ...ins);
    displayResults();
    closeSplitModal();
};

function showStatus(msg, type) {
    const el = document.getElementById('vocabStatus');
    el.innerText = msg;
    el.className = `status ${type}`;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 3000);
}