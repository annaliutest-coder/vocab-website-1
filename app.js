// app.js - 網站版生詞分析助手（含分冊累積選擇、手動切分 & 合併功能 & 綠色反白定位 & 純資料庫過濾）

let tbclData = {};
let lessonData = {}; 
let customOldVocab = new Set();
let selectedLessons = new Set();
let finalBlocklist = new Set();

// 1. 斷詞提示庫：告訴系統這些是「一個詞」，請優先斷出來
// 注意：這裡只負責斷詞，過濾功能由 finalBlocklist 負責
let knownWords = new Set(["紅色", "護龍", "還都", "看書", "吃飯", "一定", "因為", "大家", "讓"]); 

// 用於手動切分
let editingIndex = -1;
let searchState = { word: '', lastIndex: -1 };

const BOOK_ORDER = ['B1', 'B2', 'B3', 'B4', 'B5', 'B6'];

document.addEventListener('DOMContentLoaded', async () => {
  await loadData();
  setupEventListeners();
  initBackdropSync(); // 初始化背景同步
  loadCustomVocab();
  updateBlocklist();
});

async function loadData() {
  try {
    const tbclRes = await fetch('tbcl_data.json');
    tbclData = await tbclRes.json();
    const lessonRes = await fetch('vocab_by_lesson.json');
    lessonData = await lessonRes.json();
    
    // ==========================================
    // 核心修正：預設【不勾選】任何課別
    // 使用者進入網頁後，需手動選擇要避開的範圍
    // ==========================================
    selectedLessons.clear();
    // 註解掉下面這行，原本是預設全選
    // Object.keys(lessonData).forEach(k => selectedLessons.add(k));
    
    // 將所有課本生詞加入「斷詞提示庫」(knownWords)，確保斷詞準確
    // 這一步是為了讓斷詞引擎知道這些是詞彙，但過濾與否由 selectedLessons 決定
    Object.values(lessonData).forEach(wordList => wordList.forEach(w => knownWords.add(w)));

    renderLessonCheckboxes();
    console.log('資料載入完成');
  } catch (error) {
    console.error('載入失敗:', error);
    alert('載入資料失敗，請確認 JSON 檔案是否存在');
  }
}

// === 樣式同步核心 ===
function initBackdropSync() {
    const input = document.getElementById('inputText');
    const backdrop = document.getElementById('inputBackdrop');
    
    // 1. 同步 CSS 樣式
    const syncStyles = () => {
        const style = window.getComputedStyle(input);
        const props = [
            'fontFamily', 'fontSize', 'lineHeight', 'letterSpacing', 'wordSpacing',
            'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight',
            'borderTopWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderRightWidth',
            'boxSizing' // 重要
        ];
        props.forEach(p => backdrop.style[p] = style[p]);
        
        // 修正寬度：使用 clientWidth 排除捲軸寬度，確保文字折行位置一致
        backdrop.style.width = input.clientWidth + 'px';
    };

    // 2. 監聽捲動
    const syncScroll = () => {
        backdrop.scrollTop = input.scrollTop;
        backdrop.scrollLeft = input.scrollLeft;
    };

    // 3. 綁定事件
    input.addEventListener('scroll', syncScroll);
    input.addEventListener('input', () => {
        // 輸入時清空背景，避免舊的 highlight 殘留錯位
        backdrop.innerHTML = '';
        syncScroll();
    });
    
    // 視窗改變大小時重新計算
    new ResizeObserver(() => {
        syncStyles();
        syncScroll();
    }).observe(input);
    
    // 初始執行
    setTimeout(syncStyles, 100);
}

// 產生綠色底色標記 (無反白選取)
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

    // 分割文字
    const before = text.substring(0, index);
    const target = text.substring(index, index + word.length);
    const after = text.substring(index + word.length);

    // 建立 Span 底色標記 (對應 index.html 的 .highlight-marker 綠色樣式)
    const highlightMarker = `<span class="highlight-marker">${escapeHTML(target)}</span>`;

    // 組合 HTML，特別處理結尾換行
    let htmlContent = escapeHTML(before) + highlightMarker + escapeHTML(after);
    if (text.endsWith('\n')) {
        htmlContent += '<br>'; // 修正 div 最後一個換行不顯示的問題
    }

    backdrop.innerHTML = htmlContent;

    // 只捲動到該位置，不執行 setSelectionRange (不反白)
    const marker = backdrop.querySelector('.highlight-marker');
    if (marker) {
        // 計算捲動位置，讓標記出現在畫面中間
        const offsetTop = marker.offsetTop;
        const scrollTarget = offsetTop - (input.clientHeight / 2) + (marker.offsetHeight / 2);
        
        // 設定捲動 (會透過 syncScroll 自動同步 backdrop)
        input.scrollTop = scrollTarget;
        
        // 確保輸入框獲得焦點，方便鍵盤操作，但不要選取文字
        input.focus(); 
        input.setSelectionRange(index, index); // 將游標置於詞彙開頭，但不選取
    }
}

function escapeHTML(text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
               .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function renderLessonCheckboxes() {
  const container = document.getElementById('lessonCheckboxes');
  container.innerHTML = '';
  const books = {};
  BOOK_ORDER.forEach(b => books[b] = []);
  Object.keys(lessonData).forEach(k => {
    const m = k.match(/^(B\d+)/);
    if (m && books[m[1]]) books[m[1]].push(k);
  });

  BOOK_ORDER.forEach(bookName => {
      const lessons = books[bookName];
      if (lessons.length === 0) return;
      lessons.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

      const groupDiv = document.createElement('div');
      groupDiv.className = 'book-group';
      
      const header = document.createElement('div');
      header.className = 'book-header';
      
      const masterCb = document.createElement('input');
      masterCb.type = 'checkbox';
      masterCb.className = 'book-master-cb';
      masterCb.dataset.book = bookName;
      masterCb.onclick = (e) => {
          e.stopPropagation();
          const checked = e.target.checked;
          const lessonCbs = groupDiv.querySelectorAll('.lesson-cb');
          lessonCbs.forEach(cb => {
              cb.checked = checked;
              if (checked) selectedLessons.add(cb.value); else selectedLessons.delete(cb.value);
          });
          updateBlocklist();
      };

      header.innerHTML += `<span> ${bookName} (${lessons.length} 課)</span>`;
      const arrow = document.createElement('span');
      arrow.textContent = '▼';
      arrow.style.marginLeft = 'auto';
      header.appendChild(arrow);
      header.prepend(masterCb);

      const content = document.createElement('div');
      content.className = 'book-content';
      content.id = `content-${bookName}`;
      if (bookName === 'B1') { content.classList.add('open'); arrow.textContent = '▲'; }

      header.onclick = (e) => {
          if (e.target.type === 'checkbox') return;
          content.classList.toggle('open');
          arrow.textContent = content.classList.contains('open') ? '▲' : '▼';
      };

      lessons.forEach(l => {
          const lbl = document.createElement('label');
          lbl.className = 'checkbox-item';
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.value = l;
          cb.className = `lesson-cb book-${bookName}`;
          // 這裡根據 selectedLessons 設定是否勾選，現在預設為 false
          cb.checked = selectedLessons.has(l);
          cb.onchange = () => {
              if (cb.checked) selectedLessons.add(l); else selectedLessons.delete(l);
              updateBlocklist();
          };
          lbl.append(cb, l);
          content.appendChild(lbl);
      });
      groupDiv.append(header, content);
      container.appendChild(groupDiv);
  });
  updateBookMasterStatus();
  updateSelectedCountUI();
}

function updateBookMasterStatus() {
    BOOK_ORDER.forEach(b => {
        const cbs = document.querySelectorAll(`.lesson-cb.book-${b}`);
        if (!cbs.length) return;
        const checked = document.querySelectorAll(`.lesson-cb.book-${b}:checked`).length;
        const master = document.querySelector(`.book-master-cb[data-book="${b}"]`);
        if (master) {
            master.checked = checked === cbs.length && cbs.length > 0;
            master.indeterminate = checked > 0 && checked < cbs.length;
        }
    });
}

window.selectUpTo = function(targetBook) {
    const idx = BOOK_ORDER.indexOf(targetBook);
    if (idx === -1) return;
    const cbs = document.querySelectorAll('.lesson-cb');
    cbs.forEach(cb => {
        const m = cb.value.match(/^(B\d+)/);
        if (m) {
            const bIdx = BOOK_ORDER.indexOf(m[1]);
            if (bIdx <= idx) { cb.checked = true; selectedLessons.add(cb.value); }
            else { cb.checked = false; selectedLessons.delete(cb.value); }
        }
    });
    updateBlocklist();
    document.querySelectorAll('.book-content').forEach(el => el.classList.remove('open'));
    const tContent = document.getElementById(`content-${targetBook}`);
    if (tContent) tContent.classList.add('open');
}

window.toggleBook = function(targetBook) {
    const cbs = document.querySelectorAll(`.lesson-cb.book-${targetBook}`);
    const allChecked = Array.from(cbs).every(c => c.checked);
    cbs.forEach(cb => {
        cb.checked = !allChecked;
        if (!allChecked) selectedLessons.add(cb.value); else selectedLessons.delete(cb.value);
    });
    updateBlocklist();
}

window.toggleAllLessons = function(checked) {
    const cbs = document.querySelectorAll('.lesson-cb');
    selectedLessons.clear();
    cbs.forEach(cb => {
        cb.checked = checked;
        if (checked) selectedLessons.add(cb.value);
    });
    updateBlocklist();
}

function updateSelectedCountUI() {
    document.getElementById('selectedLessonCount').innerText = selectedLessons.size;
}

function updateBlocklist() {
    finalBlocklist.clear();
    // 1. 加入勾選的課本詞彙
    selectedLessons.forEach(l => {
        if (lessonData[l]) lessonData[l].forEach(w => finalBlocklist.add(w));
    });
    
    // 2. 加入手動補充的詞彙
    customOldVocab.forEach(w => finalBlocklist.add(w));
    
    document.getElementById('totalBlockedCount').innerText = finalBlocklist.size;
    updateSelectedCountUI();
    updateBookMasterStatus();
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
    
    // 新增舊詞後，立即重新分析
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
        // 清除後也重新分析
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