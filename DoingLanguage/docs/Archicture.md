# DoingLanguage — Progressive Speech & Language Training Tool

Listed directory js
Listed directory engine
Listed directory services
Listed directory exercises
Viewed exercise-engine.js:1-60

Here is the complete set of **UML Diagrams** for **DoingLanguage**, modeled directly on your codebase architecture and clinical PML (Principles of Motor Learning) flow.

You can copy and paste these into GitHub Markdown, Devpost, or any Mermaid-compatible viewer.

---

### 1. UML Use Case Diagram
*Defines the roles of the Patient, Speech-Language Pathologist (SLP), and System Agent.*

```mermaid
flowchart LR
    Patient((fa:fa-user Patient))
    SLP((fa:fa-user-md SLP / Clinician))
    Agent((fa:fa-robot Agent Engine))

    subgraph DoingLanguage["DoingLanguage System"]
        UC1(["Select 10-Tier Exercise"])
        UC2(["Listen to Speech Model"])
        UC3(["Voice Production Practice"])
        UC4(["Receive Multi-Modal Cues"])
        UC5(["View Visual Progress & Streaks"])
        UC6(["Adjust Cue Hierarchy"])
        UC7(["Detect Cognitive Fatigue"])
        UC8(["Prescribe Custom Word Lists"])
        UC9(["Export NDIS Telemetry Reports"])
        UC10(["Offline Data Sync"])
    end

    Patient --> UC1
    Patient --> UC2
    Patient --> UC3
    Patient --> UC4
    Patient --> UC5

    Agent --> UC4
    Agent --> UC6
    Agent --> UC7

    SLP --> UC8
    SLP --> UC9
    SLP --> UC5

    UC3 -.->|includes| UC4
    UC3 -.->|triggers| UC7
    UC5 -.->|syncs via| UC10
```

---

### 2. UML Component Architecture Diagram
*Shows the modular structure and data flow between UI, Core Engines, Services, and Storage.*

```mermaid
graph TD
    subgraph UI_Layer["UI & Presentation Layer"]
        APP["app.js (Main Controller)"]
        SIDEBAR["Sidebar Navigation"]
        HEADER["App Header & Controls"]
        DASHBOARD["Dashboard & Telemetry UI"]
        SETTINGS["Settings Panel"]
    end

    subgraph EXERCISE_VIEWS["Exercise Components"]
        LR["Listen & Repeat"]
        MC["Multiple Choice"]
        MP["Match Pairs"]
        SO["Sequence Order"]
    end

    subgraph ENGINE_LAYER["Core Engine"]
        EE["ExerciseEngine"]
        CURR["CurriculumManager"]
        SCORE["ScoringEngine"]
        CUE["CueingSystem"]
    end

    subgraph SERVICES_LAYER["Services Layer"]
        SPEECH_OUT["SpeechSynthesisService (TTS)"]
        SPEECH_IN["SpeechRecognitionService (STT)"]
        AUDIO_FX["AudioFeedbackService"]
        PROG["ProgressTracker"]
        STORAGE["StorageService (IndexedDB)"]
    end

    subgraph DATA_LAYER["Data Layer"]
        JSON_DATA["Exercise Banks (JSON)"]
        IDB[("IndexedDB (Local Store)")]
        SW["ServiceWorker (Cache API)"]
    end

    APP --> SIDEBAR
    APP --> DASHBOARD
    APP --> SETTINGS
    APP --> EXERCISE_VIEWS

    EXERCISE_VIEWS --> EE
    EE --> CURR
    EE --> SCORE
    EE --> CUE
    EE --> PROG

    CURR --> JSON_DATA
    PROG --> STORAGE
    STORAGE --> IDB

    EE --> SPEECH_OUT
    EE --> SPEECH_IN
    EE --> AUDIO_FX

    SW --> JSON_DATA
    SW --> APP
```

---

### 3. UML Class Diagram
*Illustrates the classes, methods, properties, and relationships in the codebase.*

```mermaid
classDiagram
    class ExerciseEngine {
        +String tier
        +String subtier
        +String exerciseType
        +Array items
        +Number currentIndex
        +Array results
        +Boolean isComplete
        +currentItem() Item
        +sessionProgress() ProgressInfo
        +remaining() Number
        +submitAnswer(answer) Result
        +nextItem() Item
        +restart() void
    }

    class ScoringEngine {
        +calculateScore(target, answer, type) ScoreResult
        +levenshteinDistance(str1, str2) Number
        +phoneticMatch(target, spoken) Boolean
        +calculateAccuracy(history) Number
    }

    class CueingSystem {
        +Number currentLevel
        +Array cueTypes
        +getCurrentCue(item) Cue
        +requestNextCue(item) Cue
        +fadeCue() void
        +resetCues() void
    }

    class CurriculumManager {
        +Array tiers
        +Object cache
        +loadTier(tierId) Promise
        +getItemsForSubtier(tier, subtier) Array
        +getExerciseTypes(subtier) Array
    }

    class SpeechSynthesisService {
        +Boolean isSupported
        +SpeechSynthesisVoice selectedVoice
        +Number rate
        +Number pitch
        +speak(text, options) Promise
        +stop() void
        +getVoices() Array
    }

    class SpeechRecognitionService {
        +Boolean isSupported
        +Boolean isListening
        +startListening(targetWord) Promise
        +stopListening() void
        +onResult(callback) void
        +onError(callback) void
    }

    class ProgressTracker {
        +recordAttempt(tier, subtier, score) void
        +getDailyRepetitions() Number
        +getStreakCount() Number
        +exportNDISReport() Object
        +syncToStorage() Promise
    }

    class StorageService {
        +get(key) Promise
        +set(key, value) Promise
        +delete(key) Promise
        +clear() Promise
    }

    ExerciseEngine --> ScoringEngine : uses
    ExerciseEngine --> CueingSystem : coordinates
    ExerciseEngine --> CurriculumManager : queries
    ExerciseEngine --> ProgressTracker : updates
    ExerciseEngine --> SpeechSynthesisService : triggers TTS
    ExerciseEngine --> SpeechRecognitionService : captures STT
    ProgressTracker --> StorageService : persists to
```

---

### 4. UML Sequence Diagram: Exercise Execution & Speech Feedback Loop
*Traces the message flow when a patient performs a speech production exercise.*

```mermaid
sequenceDiagram
    autonumber
    actor Patient
    participant UI as Exercise View
    participant EE as ExerciseEngine
    participant TTS as SpeechSynthesis
    participant CUE as CueingSystem
    participant STT as SpeechRecognition
    participant SCORE as ScoringEngine
    participant PROG as ProgressTracker
    participant DB as Storage (IndexedDB)

    Patient->>UI: Selects Exercise Target (e.g., Tier 1.3 /b/)
    UI->>EE: Load Item
    EE->>TTS: speak("b") [Auditory Model]
    TTS-->>Patient: Plays clear phoneme audio

    opt Patient requests assistance
        Patient->>UI: Taps "Need Help / Cue"
        UI->>CUE: requestNextCue(item)
        CUE-->>UI: Returns visual mouth placement & phonetic hint
        UI-->>Patient: Displays cue animation
    end

    Patient->>UI: Taps "Speak / Record"
    UI->>STT: startListening()
    Patient->>STT: Spoken vocalization
    STT-->>EE: Recognized speech transcript + confidence

    EE->>SCORE: calculateScore(target, transcript)
    SCORE-->>EE: Returns { accuracy, correct: true, score: 0.95 }

    alt Correct Production
        EE->>CUE: fadeCue() [Step towards independence]
        EE->>UI: Show encouraging visual feedback & play chime
    else Inaccurate / Dysfluent Production
        EE->>CUE: maintainOrStepUpCue()
        EE->>UI: Show gentle retry hint (no penalty)
    end

    EE->>PROG: recordAttempt(result)
    PROG->>DB: Save session repetition data
    EE->>UI: Advance to next item (or repeat target)
```

---

### 5. UML State Machine: Exercise Lifecycle & Fatigue Management
*Shows state transitions during a user practice session.*

```mermaid
stateDiagram-v2
    [*] --> Idle: App Ready

    state ExerciseSession {
        Idle --> ItemLoaded: Select Tier / Subtier
        ItemLoaded --> PresentingModel: Auto-play / See & Hear
        PresentingModel --> AwaitingPatientAction: Model Finished

        AwaitingPatientAction --> CueDisplayed: Tap "Cue" (Assistance)
        CueDisplayed --> AwaitingPatientAction

        AwaitingPatientAction --> CapturingSpeech: Tap "Microphone"
        CapturingSpeech --> EvaluatingSpeech: Audio Input Received
        CapturingSpeech --> AwaitingPatientAction: Timeout / Cancel

        EvaluatingSpeech --> FeedbackSuccess: Score >= Threshold
        EvaluatingSpeech --> FeedbackRetry: Score < Threshold

        FeedbackSuccess --> CheckingFatigue: Update Repetition Count
        FeedbackRetry --> CheckingFatigue: Log Error Count

        state CheckingFatigue <<choice>>
        CheckingFatigue --> FatiguePausePrompt: Consecutive Errors / Latency High
        CheckingFatigue --> NextItemCheck: Normal Fatigue Metrics

        FatiguePausePrompt --> NextItemCheck: Resume
        FatiguePausePrompt --> Idle: Rest Break Accepted

        state NextItemCheck <<choice>>
        NextItemCheck --> ItemLoaded: More Items Remaining
        NextItemCheck --> SessionSummary: All Items Complete
    }

    SessionSummary --> Idle: Return to Dashboard
    Idle --> [*]
```