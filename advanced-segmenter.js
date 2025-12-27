// advanced-segmenter.js - 進階中文斷詞引擎 (含上下文歧義修正)

// ========================================
// 1. 斷詞主入口
// ========================================

/**
 * 主要斷詞函式
 * @param {string} text - 待分析文本
 * @param {object} tbclData - TBCL 詞彙資料庫 {詞: 等級}
 * @param {Set} blocklist - 舊詞過濾清單 (可選)
 * @param {boolean} splitSentence - 是否先切分句子 (預設 true)
 * @param {boolean} useGrammarRules - 是否使用詞性規則優化 (預設 true)
 * @returns {Array} - 斷詞結果陣列
 */
function advancedSegment(text, tbclData, blocklist, splitSentence = true, useGrammarRules = true) {
  if (!text) return [];

  // 1. 建立完整參考字典 (包含 TBCL + 舊詞 + 預設已知詞)
  // 這確保所有已知詞彙都能被搜尋到
  const dictionary = new Set(Object.keys(tbclData));
  if (blocklist) {
    blocklist.forEach(w => dictionary.add(w));
  }

  // 2. 清理與分句
  const cleanedText = text.replace(/\r\n/g, '\n');
  let segments = [];

  if (splitSentence) {
    // 依標點符號初步切分，避免長句造成遞迴過深
    const sentences = cleanedText.split(/([。，、；：！？「」『』（）《》…—\s\d]+)/);
    
    for (const sent of sentences) {
      if (!sent.trim()) {
        if (sent) segments.push(sent); // 保留標點
        continue;
      }
      // 處理單句
      segments.push(...processSentence(sent, dictionary, useGrammarRules));
    }
  } else {
    segments = processSentence(cleanedText, dictionary, useGrammarRules);
  }

  return segments;
}

// ========================================
// 2. 核心處理邏輯
// ========================================

function processSentence(sentence, dictionary, useRules) {
  // A. 正向最大匹配 (FMM)
  const fmm = forwardMaxMatch(sentence, dictionary);
  
  // B. 逆向最大匹配 (BMM)
  const bmm = backwardMaxMatch(sentence, dictionary);

  // C. 雙向結果比對與選擇
  let result = selectBestResult(fmm, bmm);

  // D. 上下文歧義修正 (關鍵步驟：看意思)
  if (useRules) {
    result = applyContextRules(result, dictionary);
  }

  return result;
}

// 正向最大匹配 (從左到右，貪婪)
function forwardMaxMatch(text, dict) {
  let result = [];
  let index = 0;
  const len = text.length;
  const MAX_LEN = 6; // 假設最長詞長度

  while (index < len) {
    let match = null;
    // 嘗試從最長可能的詞開始匹配
    for (let i = Math.min(len - index, MAX_LEN); i > 0; i--) {
      const sub = text.substr(index, i);
      if (dict.has(sub) || sub.length === 1) { // 字典有，或是單字
        // 特殊檢查：如果字典沒有，但符合 "AA" 或 "AABB" 疊字，視為詞
        if (!dict.has(sub) && isReduplication(sub)) {
             match = sub;
             break;
        }
        if (dict.has(sub)) {
            match = sub;
            break;
        }
      }
    }
    
    if (!match) match = text[index]; // 兜底：單字
    result.push(match);
    index += match.length;
  }
  return result;
}

// 逆向最大匹配 (從右到左，貪婪)
function backwardMaxMatch(text, dict) {
  let result = [];
  let index = text.length;
  const MAX_LEN = 6;

  while (index > 0) {
    let match = null;
    for (let i = Math.min(index, MAX_LEN); i > 0; i--) {
      const sub = text.substr(index - i, i);
      if (dict.has(sub)) {
        match = sub;
        break;
      }
    }
    if (!match) match = text.substr(index - 1, 1);
    result.unshift(match); // 插入到開頭
    index -= match.length;
  }
  return result;
}

// 選擇最佳結果 (FMM vs BMM)
// 原則：詞數越少越好 (Granularity)，單字越少越好
function selectBestResult(fmm, bmm) {
  if (fmm.length !== bmm.length) {
    return fmm.length < bmm.length ? fmm : bmm;
  }
  
  // 如果詞數一樣，算單字數量 (單字越少越好)
  const fmmSingle = fmm.filter(w => w.length === 1).length;
  const bmmSingle = bmm.filter(w => w.length === 1).length;
  
  if (fmmSingle !== bmmSingle) {
    return fmmSingle < bmmSingle ? fmm : bmm;
  }

  // 默認回傳逆向 (通常 BMM 對中文準確度略高)
  return bmm;
}

// ========================================
// 3. 上下文與歧義修正規則 (Context Aware)
// ========================================

function applyContextRules(words, dict) {
  let newWords = [...words];

  // 規則 1: 修正「地」的歧義 (Particle 'de' vs Noun 'di')
  // 案例：[開, 心地] -> [開心, 地]
  // 邏輯：如果後詞以「地」結尾 (如心地)，且 前詞+後詞去地 (如開+心) 是一個有效詞
  newWords = fixParticleAmbiguity(newWords, dict, '地');

  // 規則 2: 修正「都」的歧義
  // 案例：[還, 都] vs [還都] (歷史名詞)
  // 如果 [還都] 被切成一個詞，但其實不是講歷史，通常「還」+「都」頻率更高
  // 這裡比較難，因為「還都」在字典裡。
  // 策略：如果「還都」出現，除非是特定名詞上下文，否則拆開。(簡單啟發式：拆)
  newWords = splitSpecificWords(newWords, ['還都']);

  // 規則 3: 強制合併規則 (顏色、方位等)
  // 案例：[紅, 色] -> [紅色]
  newWords = mergeSuffixRules(newWords, dict);

  return newWords;
}

/**
 * 修正助詞歧義 (最核心的「看意思」邏輯)
 * 針對：AB + C地 vs A + BC地
 */
function fixParticleAmbiguity(words, dict, particle) {
  if (words.length < 2) return words;
  
  const result = [];
  for (let i = 0; i < words.length; i++) {
    const curr = words[i];
    const prev = i > 0 ? words[i-1] : null;

    // 檢查模式：Prev + Curr (其中 Curr 是 "X地" 形式，如 "心地")
    // 目標：判斷是否應該切成 Prev + X + 地
    if (prev && curr.length === 2 && curr.endsWith(particle)) {
        const potentialWord = prev + curr.charAt(0); // e.g. 開 + 心 = 開心
        const suffixWord = curr; // e.g. 心地

        // 判斷依據：如果 Potential (開心) 是已知詞，且是形容詞/動詞性質
        // 而 Suffix (心地) 雖然也是詞，但在這裡組合起來怪怪的
        // 簡單判斷：優先權 check
        if (dict.has(potentialWord)) {
            // 修正：移除 prev，加入 potentialWord，再加入 particle
            result.pop(); // 移除已加入的 prev
            result.push(potentialWord);
            result.push(particle);
            continue;
        }
    }
    
    result.push(curr);
  }
  return result;
}

/**
 * 強制拆分某些容易誤判的詞
 */
function splitSpecificWords(words, targets) {
    const result = [];
    words.forEach(w => {
        if (targets.includes(w)) {
            // 強制拆成單字 (e.g. 還都 -> 還, 都)
            // 除非真的要教歷史課文，否則「還都」99%是「還+都」
            for (let char of w) result.push(char);
        } else {
            result.push(w);
        }
    });
    return result;
}

/**
 * 合併後綴規則
 * 案例：紅 + 色 -> 紅色
 */
function mergeSuffixRules(words, dict) {
    if (words.length < 2) return words;
    const result = [words[0]];
    
    for (let i = 1; i < words.length; i++) {
        const curr = words[i];
        const prev = result[result.length - 1]; // 這裡要抓 result 的最後一個，因為可能發生連續合併
        
        let merged = false;

        // 規則 A: [X] + [色] -> 合併 (若 X色 在字典或 X 是單字形容詞)
        if (curr === '色' && prev.length === 1) {
             // 假設單字 + 色 都是詞 (紅色, 綠色, 藍色)
             result[result.length - 1] = prev + curr;
             merged = true;
        }
        
        // 規則 B: [X] + [們] -> 合併 (我們, 同學們)
        else if (curr === '們') {
            result[result.length - 1] = prev + curr;
            merged = true;
        }

        if (!merged) {
            result.push(curr);
        }
    }
    return result;
}

// 輔助：判斷是否為疊字 (AA, AABB)
function isReduplication(str) {
    if (str.length === 2 && str[0] === str[1]) return true; // AA (慢慢)
    if (str.length === 4 && str[0] === str[1] && str[2] === str[3]) return true; // AABB (高高興興)
    return false;
}