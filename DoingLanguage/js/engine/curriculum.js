/**
 * DoingLanguage — Curriculum Definition
 * Defines all tiers, sub-tiers, and their exercise types.
 * Phase 1: Tier 1 is active. Tiers 2–10 are shown but locked.
 */

export const CURRICULUM = [
  {
    id: '1',
    name: 'Foundations',
    icon: '🔤',
    description: 'Letters, words, sounds, numbers, and punctuation',
    locked: false,
    subtiers: [
      {
        id: '1.1',
        name: 'Lowercase Letters',
        description: 'Recognise, identify, and say the 26 lowercase letters a–z',
        dataFile: 'data/tier1/letters.json',
        exerciseTypes: [
          { type: 'multiple-choice', name: 'Identify Lowercase Letter', icon: '🎯', description: 'Hear a letter name, choose the matching lowercase letter' },
          { type: 'listen-repeat', name: 'Say the Letter', icon: '🗣️', description: 'See a lowercase letter, say its name aloud' },
        ],
        getItemDisplay: (item) => item.lower,
        getItemLabel: (item) => item.lower,
        getItemSpeech: (item) => item.name,
      },
      {
        id: '1.2',
        name: 'Letter & Word Match',
        description: 'Match each letter to a starting word (e.g. n ↔ nest, a ↔ apple, b ↔ ball)',
        dataFile: 'data/tier1/letters.json',
        exerciseTypes: [
          { type: 'match-pairs', name: 'Match Letter to Word', icon: '🔗', description: 'Connect letters to starting words (e.g. n ↔ nest)' },
          { type: 'multiple-choice', name: 'Choose Matching Word', icon: '🎯', description: 'See a letter, select the word starting with that letter' },
        ],
        getItemDisplay: (item) => item.lower,
        getItemLabel: (item) => (item.exampleWords?.[0]?.word || item.name),
        getItemSpeech: (item) => `${item.lower}, ${item.exampleWords?.[0]?.word || ''}`,
      },
      {
        id: '1.3',
        name: 'Letter Sounds',
        description: 'Learn the sounds each letter makes (44 phonemes)',
        dataFile: 'data/tier1/phonemes.json',
        exerciseTypes: [
          { type: 'multiple-choice', name: 'Sound Match', icon: '🎯', description: 'Hear a sound, choose which letter makes it' },
          { type: 'listen-repeat', name: 'Make the Sound', icon: '🗣️', description: 'See the letter, make its sound' },
        ],
        getItemDisplay: (item) => item.graphemes?.[0] || item.ipa,
        getItemLabel: (item) => item.ipa,
        getItemSpeech: (item) => item.examples?.initial?.word || item.graphemes?.[0] || '',
      },
      {
        id: '1.4',
        name: 'Numbers 0–100',
        description: 'Recognise and name numbers from zero to one hundred',
        dataFile: 'data/tier1/numbers.json',
        exerciseTypes: [
          { type: 'multiple-choice', name: 'Name the Number', icon: '🎯', description: 'See a number, choose its word form' },
          { type: 'listen-repeat', name: 'Say the Number', icon: '🗣️', description: 'See a number, say it aloud' },
          { type: 'sequence-order', name: 'Put in Order', icon: '🔢', description: 'Arrange numbers in the correct order' },
        ],
        getItemDisplay: (item) => String(item.digit),
        getItemLabel: (item) => item.word,
        getItemSpeech: (item) => item.word,
      },
      {
        id: '1.5',
        name: 'Punctuation',
        description: 'Learn the names and uses of common punctuation marks',
        dataFile: 'data/tier1/punctuation.json',
        exerciseTypes: [
          { type: 'multiple-choice', name: 'Name the Mark', icon: '🎯', description: 'See a punctuation mark, choose its name' },
        ],
        getItemDisplay: (item) => item.symbol,
        getItemLabel: (item) => item.name,
        getItemSpeech: (item) => item.name,
      },
      {
        id: '1.6',
        name: 'Uppercase Letters',
        description: 'Recognise uppercase letters A–Z and match with lowercase',
        dataFile: 'data/tier1/letters.json',
        exerciseTypes: [
          { type: 'multiple-choice', name: 'Identify Uppercase Letter', icon: '🎯', description: 'Hear a letter name, choose the correct uppercase letter' },
          { type: 'listen-repeat', name: 'Say Uppercase Letter', icon: '🗣️', description: 'See an uppercase letter, say its name aloud' },
          { type: 'match-pairs', name: 'Match Upper & Lower', icon: '🔗', description: 'Match uppercase letters A–Z to lowercase a–z' },
        ],
        getItemDisplay: (item) => item.upper,
        getItemLabel: (item) => item.lower,
        getItemSpeech: (item) => item.upper,
      },
    ],
  },
  // Future tiers — shown but locked in Phase 1
  {
    id: '2',
    name: 'Syllables',
    icon: '🧩',
    description: 'Build from sounds to syllables',
    locked: true,
    subtiers: [
      { id: '2.1', name: 'CV Syllables', description: 'Consonant + vowel: ba, da, go', locked: true },
      { id: '2.2', name: 'VC Syllables', description: 'Vowel + consonant: at, in, up', locked: true },
      { id: '2.3', name: 'CVC Syllables', description: 'Consonant-vowel-consonant: bat, dog', locked: true },
      { id: '2.4', name: 'Blends & Clusters', description: 'CCVC and CVCC: stop, milk', locked: true },
      { id: '2.5', name: 'Multi-syllable', description: 'Two and three syllable words', locked: true },
      { id: '2.6', name: 'Rhyming', description: 'Match and produce rhyming words', locked: true },
    ],
  },
  {
    id: '3',
    name: 'Words',
    icon: '📝',
    description: 'Build meaningful words from syllables',
    locked: true,
    subtiers: [
      { id: '3.1', name: 'High-Frequency Words', description: 'Common everyday vocabulary', locked: true },
      { id: '3.2', name: 'Word Families', description: 'Words sharing patterns (-at, -an)', locked: true },
      { id: '3.3', name: 'Prefixes & Suffixes', description: 'Build words with affixes', locked: true },
      { id: '3.4', name: 'Emergency Vocabulary', description: 'Critical safety phrases', locked: true },
    ],
  },
  {
    id: '3.5',
    name: 'Compound Words',
    icon: '🔗',
    description: 'Two words becoming one',
    locked: true,
    subtiers: [
      { id: '3.5.1', name: 'Common Compounds', description: 'sunflower, football, bedroom', locked: true },
    ],
  },
  {
    id: '3.6',
    name: 'Synonyms & Opposites',
    icon: '🔄',
    description: 'Expand your word network',
    locked: true,
    subtiers: [
      { id: '3.6.1', name: 'Antonyms', description: 'hot↔cold, big↔small', locked: true },
      { id: '3.6.2', name: 'Synonyms', description: 'happy=glad, large=big', locked: true },
      { id: '3.6.3', name: 'Categories', description: 'Sorting words into groups', locked: true },
    ],
  },
  {
    id: '3.7',
    name: 'Heteronyms',
    icon: '🎭',
    description: 'Same spelling, different pronunciation',
    locked: true,
    subtiers: [
      { id: '3.7.1', name: 'In-Context Reading', description: 'lead, tear, wind, read', locked: true },
    ],
  },
  {
    id: '4',
    name: 'Sentences',
    icon: '💬',
    description: 'Build and understand sentences',
    locked: true,
    subtiers: [
      { id: '4.1', name: 'Subject–Verb', description: 'Dogs run. Birds sing.', locked: true },
      { id: '4.2', name: 'Subject–Verb–Object', description: 'The cat chased the mouse.', locked: true },
      { id: '4.3', name: 'Expanding Sentences', description: 'Add detail with adjectives and adverbs', locked: true },
      { id: '4.4', name: 'Questions', description: 'Form and answer questions', locked: true },
      { id: '4.5', name: 'Complex Sentences', description: 'Join ideas with conjunctions', locked: true },
    ],
  },
  {
    id: '5',
    name: 'Paragraphs',
    icon: '📖',
    description: 'Connected text and comprehension',
    locked: true,
    subtiers: [
      { id: '5.1', name: 'Sentence Sequencing', description: 'Arrange sentences logically', locked: true },
      { id: '5.2', name: 'Reading Comprehension', description: 'Read and answer questions', locked: true },
      { id: '5.3', name: 'Paragraph Building', description: 'Construct coherent paragraphs', locked: true },
    ],
  },
  {
    id: '6',
    name: 'Concepts',
    icon: '💡',
    description: 'Real-world reasoning and pragmatics',
    locked: true,
    subtiers: [
      { id: '6.1', name: 'Categories', description: 'Classify and sort items', locked: true },
      { id: '6.2', name: 'Time Concepts', description: 'Clocks, days, before/after', locked: true },
      { id: '6.3', name: 'Spatial Concepts', description: 'In, on, under, beside', locked: true },
      { id: '6.4', name: 'Homophones', description: 'there/their/they\'re', locked: true },
      { id: '6.5', name: 'Idioms', description: 'Figurative language', locked: true },
      { id: '6.6', name: 'Conversation', description: 'Social communication scripts', locked: true },
    ],
  },
  {
    id: '7',
    name: 'Prosody',
    icon: '🎵',
    description: 'Stress, rhythm, and intonation',
    locked: true,
    subtiers: [
      { id: '7.1', name: 'Stress Patterns', description: 'Which syllable to emphasise', locked: true },
      { id: '7.2', name: 'Intonation', description: 'Rising and falling pitch', locked: true },
    ],
  },
  {
    id: '8',
    name: 'Minimal Pairs',
    icon: '👂',
    description: 'Hear and produce fine sound differences',
    locked: true,
    subtiers: [
      { id: '8.1', name: 'Sound Discrimination', description: 'bat/pat, sip/zip', locked: true },
    ],
  },
  {
    id: '9',
    name: 'Word Finding',
    icon: '🔍',
    description: 'Strategies for retrieving words',
    locked: true,
    subtiers: [
      { id: '9.1', name: 'Circumlocution', description: 'Describe the word you cannot find', locked: true },
      { id: '9.2', name: 'Semantic Cues', description: 'Use category and feature clues', locked: true },
    ],
  },
  {
    id: '10',
    name: 'Communication',
    icon: '🤝',
    description: 'Real-world connected speaking',
    locked: true,
    subtiers: [
      { id: '10.1', name: 'Scripts', description: 'Ordering food, phone calls', locked: true },
      { id: '10.2', name: 'Picture Description', description: 'Describe scenes in sentences', locked: true },
    ],
  },
];

/**
 * Look up a tier by ID.
 * @param {string} tierId
 * @returns {object|undefined}
 */
export function getTier(tierId) {
  return CURRICULUM.find(t => t.id === tierId);
}

/**
 * Look up a sub-tier by its dotted ID (e.g. "1.1").
 * @param {string} subtierId
 * @returns {{tier: object, subtier: object}|null}
 */
export function getSubtier(subtierId) {
  for (const tier of CURRICULUM) {
    if (!tier.subtiers) continue;
    const sub = tier.subtiers.find(s => s.id === subtierId);
    if (sub) return { tier, subtier: sub };
  }
  return null;
}

/**
 * Get all unlocked sub-tiers in curriculum order.
 * @returns {Array<{tier, subtier}>}
 */
export function getUnlockedSubtiers() {
  const result = [];
  for (const tier of CURRICULUM) {
    if (tier.locked) continue;
    for (const sub of (tier.subtiers || [])) {
      if (!sub.locked) result.push({ tier, subtier: sub });
    }
  }
  return result;
}

export default CURRICULUM;
