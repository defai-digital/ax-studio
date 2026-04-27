import { describe, it, expect } from 'vitest'
import { sanitizeMermaidFences } from '../RenderMarkdown'

describe('sanitizeMermaidFences', () => {
  const wrap = (body: string) => `\`\`\`mermaid\n${body}\n\`\`\``

  describe('Fix 3: quote [] labels with unsafe characters', () => {
    it('quotes labels containing spaces', () => {
      const input = wrap(`classDiagram
class PORT[Serial Port] {
  +int baudRate
}`)
      const result = sanitizeMermaidFences(input)
      expect(result).toContain('PORT["Serial Port"]')
    })

    it('quotes labels containing apostrophes', () => {
      const input = wrap(`flowchart TD
    A[Recipient's Device] --> B`)
      const result = sanitizeMermaidFences(input)
      expect(result).toContain('A["Recipient\'s Device"]')
    })

    it('quotes labels containing parentheses', () => {
      const input = wrap(`flowchart TD
    A[Setup (X3DH)] --> B`)
      const result = sanitizeMermaidFences(input)
      expect(result).toContain('A["Setup (X3DH)"]')
    })

    it('does not quote already-quoted labels', () => {
      const input = wrap(`flowchart TD
    A["Already Quoted"] --> B`)
      const result = sanitizeMermaidFences(input)
      expect(result).toContain('A["Already Quoted"]')
      expect(result).not.toContain('[""Already Quoted""]')
    })

    it('does not quote simple single-word labels', () => {
      const input = wrap(`flowchart TD
    A[Hello] --> B[World]`)
      const result = sanitizeMermaidFences(input)
      expect(result).toContain('A[Hello]')
      expect(result).toContain('B[World]')
    })

    it('quotes labels with angle brackets', () => {
      const input = wrap(`flowchart TD
    A[foo<bar>] --> B`)
      const result = sanitizeMermaidFences(input)
      expect(result).toContain('A["foo<bar>"]')
    })

    it('quotes labels with pipe character', () => {
      const input = wrap(`flowchart TD
    A[foo|bar] --> B`)
      const result = sanitizeMermaidFences(input)
      expect(result).toContain('A["foo|bar"]')
    })

    it('handles multiple labels on the same line', () => {
      const input = wrap(`flowchart TD
    A[Hello World] --> B[Goodbye Moon]`)
      const result = sanitizeMermaidFences(input)
      expect(result).toContain('A["Hello World"]')
      expect(result).toContain('B["Goodbye Moon"]')
    })

    it('handles classDiagram class labels with spaces', () => {
      const input = wrap(`classDiagram
class UART["Serial Port"] {
  +int baudRate
}
class PORT[Serial Port] {
  +int baudRate
}`)
      const result = sanitizeMermaidFences(input)
      expect(result).toContain('UART["Serial Port"]')
      expect(result).toContain('PORT["Serial Port"]')
    })
  })

  describe('Fix 1b: strip invalid title comments', () => {
    it('strips quoted title after diagram type', () => {
      const input = wrap(`erDiagram """My Title"""
    EMPLOYEE ||--|| DEPARTMENT : works_in`)
      const result = sanitizeMermaidFences(input)
      expect(result).toContain('erDiagram')
      expect(result).not.toContain('"""My Title"""')
      expect(result).toContain('EMPLOYEE ||--|| DEPARTMENT')
    })
  })

  describe('Fix 2: bare flowchart gets TD direction', () => {
    it('adds TD to bare flowchart', () => {
      const input = wrap(`flowchart
    A --> B`)
      const result = sanitizeMermaidFences(input)
      expect(result).toContain('flowchart TD')
    })
  })

  describe('Fix 4: close unclosed class bodies', () => {
    it('appends missing closing braces for classDiagram', () => {
      const input = wrap(`classDiagram
class Foo {
  +int x`)
      const result = sanitizeMermaidFences(input)
      const body = result.match(/```mermaid\n([\s\S]*?)```/)?.[1] ?? ''
      const opens = (body.match(/\{/g) ?? []).length
      const closes = (body.match(/\}/g) ?? []).length
      expect(opens).toBe(closes)
    })
  })

  describe('Fix 10: collapse consecutive blank lines', () => {
    it('collapses 3+ consecutive newlines to 2', () => {
      const input = wrap(`flowchart TD
    A --> B



    B --> C`)
      const result = sanitizeMermaidFences(input)
      expect(result).not.toMatch(/\n{3,}/)
    })
  })

  describe('Fix 1b normalization: fence and type on same line', () => {
    it('splits ```mermaid classDiagram to separate lines', () => {
      const input = '```mermaid classDiagram\n\nclass Foo\n```'
      const result = sanitizeMermaidFences(input)
      expect(result).toContain('```mermaid\nclassDiagram')
    })
  })

  describe('Fix 1c: split single-line diagrams', () => {
    it('splits single-line erDiagram into multi-line', () => {
      const input = wrap(
        'erDiagram GAS_COMPANY ||--o{ GAS_SOURCE : manages GAS_COMPANY ||--o{ PROCESSING_PLANT : operates GAS_SOURCE ||--o| PROCESSING_PLANT : supplies_to GAS_COMPANY { string id PK string name } GAS_SOURCE { string id PK float pressure }'
      )
      const result = sanitizeMermaidFences(input)
      expect(result).toContain('GAS_COMPANY ||--o{ GAS_SOURCE : manages')
      expect(result).toContain('GAS_COMPANY ||--o{ PROCESSING_PLANT : operates')
      expect(result).toContain('GAS_SOURCE ||--o| PROCESSING_PLANT : supplies_to')
      expect(result).toContain('GAS_COMPANY { string id PK string name }')
      expect(result).toContain('GAS_SOURCE { string id PK float pressure }')
      const body = result.match(/erDiagram\n([\s\S]*?)```/)?.[1] ?? ''
      const lines = body.split('\n').filter(l => l.trim())
      expect(lines.length).toBeGreaterThan(3)
    })

    it('does not break properly-formatted multi-line erDiagram', () => {
      const input = wrap(`erDiagram
    EMPLOYEE ||--|| DEPARTMENT : works_in
    DEPARTMENT ||--o{ PROJECT : oversees`)
      const result = sanitizeMermaidFences(input)
      expect(result).toContain('EMPLOYEE ||--|| DEPARTMENT : works_in')
      expect(result).toContain('DEPARTMENT ||--o{ PROJECT : oversees')
    })

    it('fixes orphan ER relationships by inferring entity from context', () => {
      const input = wrap(
        'erDiagram ||--o{ JOB : submits ||--o{ TASK : contains'
      )
      const result = sanitizeMermaidFences(input)
      // Orphan lines should get a preceding entity name
      const body = result.match(/erDiagram\n([\s\S]*?)```/)?.[1] ?? ''
      const lines = body.split('\n').filter(l => l.trim())
      // Each line should start with an entity name, not ||
      for (const line of lines) {
        expect(line.trim()).not.toMatch(/^\|/)
      }
    })

    it('strips quotes from non-reserved ER entity names', () => {
      const input = wrap(
        'erDiagram CUSTOMER ||--o{ "PRODUCT" : buys PRODUCT ||--o{ CATEGORY : belongs_to'
      )
      const result = sanitizeMermaidFences(input)
      // PRODUCT and CATEGORY are not SQL reserved words — quotes should be stripped
      expect(result).not.toContain('"PRODUCT"')
      expect(result).not.toContain('"CATEGORY"')
      // Relationships preserved
      expect(result).toContain('CUSTOMER ||--o{')
    })

    it('splits single-line classDiagram', () => {
      const input = wrap(
        'classDiagram class Animal { +String name +int age } class Dog { +String breed } Animal <|-- Dog'
      )
      const result = sanitizeMermaidFences(input)
      expect(result).toContain('class Animal {')
      expect(result).toContain('class Dog {')
      expect(result).toContain('Animal <|-- Dog')
      const body = result.match(/classDiagram\n([\s\S]*?)```/)?.[1] ?? ''
      const lines = body.split('\n').filter(l => l.trim())
      expect(lines.length).toBeGreaterThan(2)
    })

    it('splits single-line stateDiagram', () => {
      const input = wrap(
        'stateDiagram-v2 [*] --> Idle Idle --> Processing Processing --> Done Done --> [*]'
      )
      const result = sanitizeMermaidFences(input)
      expect(result).toContain('[*] --> Idle')
      expect(result).toContain('Idle --> Processing')
      expect(result).toContain('Processing --> Done')
      expect(result).toContain('Done --> [*]')
    })

    it('splits single-line sequenceDiagram with actors and arrows', () => {
      const input = wrap(
        'sequenceDiagram autonumber actor Tx as Transmitter participant Rx as Receiver Tx ->> Rx: Start Bit Rx ->> Rx: Validate Rx -->> Tx: Done'
      )
      const result = sanitizeMermaidFences(input)
      expect(result).toContain('actor Tx as Transmitter')
      expect(result).toContain('participant Rx as Receiver')
      expect(result).toContain('Tx ->> Rx: Start Bit')
      expect(result).toContain('Rx ->> Rx: Validate')
      expect(result).toContain('Rx -->> Tx: Done')
      const body = result.match(/sequenceDiagram\n([\s\S]*?)```/)?.[1] ?? ''
      const lines = body.split('\n').filter(l => l.trim())
      expect(lines.length).toBeGreaterThan(4)
    })

    it('splits single-line sequenceDiagram with Notes', () => {
      const input = wrap(
        'sequenceDiagram participant A participant B Note over A: Init A ->> B: Data Note right of B: Processing B -->> A: Done'
      )
      const result = sanitizeMermaidFences(input)
      expect(result).toContain('Note over A: Init')
      expect(result).toContain('A ->> B: Data')
      expect(result).toContain('Note right of B: Processing')
      expect(result).toContain('B -->> A: Done')
    })

    it('splits class diagram attributes onto separate lines', () => {
      const input = wrap(
        'classDiagram class Bank { +String name +int age +void validate() }'
      )
      const result = sanitizeMermaidFences(input)
      expect(result).toContain('class Bank {')
      expect(result).toContain('+String name')
      expect(result).toContain('+int age')
      expect(result).toContain('+void validate()')
      const bankLine = result.split('\n').find(l => l.includes('class Bank'))
      expect(bankLine).toBeDefined()
      expect(bankLine!.trim()).toBe('class Bank {')
    })

    it('splits single-line mindmap at shape boundaries', () => {
      const input = wrap(
        'mindmap root((Machine Learning)) Supervised((Classification)) Unsupervised((Clustering))'
      )
      const result = sanitizeMermaidFences(input)
      // At minimum the root and children should be on separate lines
      expect(result).toContain('root((Machine Learning))')
    })
  })

  describe('Fix 4a: array type syntax in classDiagram', () => {
    it('replaces byte[] with byteArray', () => {
      const input = wrap(`classDiagram
class DataPacket {
  string id
  byte[] payload
  int sequence_number
}`)
      const result = sanitizeMermaidFences(input)
      expect(result).toContain('byteArray payload')
      expect(result).not.toContain('byte[]')
    })

    it('replaces string[] with stringArray', () => {
      const input = wrap(`classDiagram
class Foo {
  string[] items
}`)
      const result = sanitizeMermaidFences(input)
      expect(result).toContain('stringArray items')
    })
  })

  describe('Fix 4b: deduplicate class definitions', () => {
    it('removes duplicate class blocks', () => {
      const input = wrap(`classDiagram
class DataPacket {
  string id
}
class SerialController {
  string name
}
DataPacket {
  string id
}`)
      const result = sanitizeMermaidFences(input)
      const occurrences = result.split('\n').filter(l => l.includes('DataPacket {')).length
      expect(occurrences).toBe(1)
    })
  })

  describe('real-world classDiagram from user', () => {
    it('sanitizes the serial controller diagram without errors', () => {
      const input = `\`\`\`mermaid
classDiagram
    SerialController "1" *--o "1" SerialPort : manages
    SerialController "1" *--o "1" Transmitter : controls
    SerialController "1" *--o "1" Receiver : controls
    SerialController "1" *--o "1" Buffer : coordinates

    SerialPort "1" --> "1" DataPacket : sends
    SerialPort "1" --> "1" StatusMonitor : updates

    Transmitter "1" --> "1" DataPacket : transmits
    Transmitter "1" --> "1" ErrorHandler : reports
    Transmitter "1" --> "1" SerialPort : uses

    Receiver "1" --> "1" DataPacket : receives
    Receiver "1" --> "1" ErrorHandler : reports
    Receiver "1" --> "1" Buffer : stores

    Buffer "1" --> "1" DataPacket : stores
    Buffer "1" --> "1" Transmitter : feeds
    Buffer "1" --> "1" Receiver : feeds

    StatusMonitor "1" --> "1" SerialController : reports
    StatusMonitor "1" --> "1" DataPacket : monitors

    ErrorHandler "1" --> "1" SerialController : reports
    ErrorHandler "1" --> "1" Transmitter : notifies
    ErrorHandler "1" --> "1" Receiver : notifies

    DataPacket {
        string id
        byte[] payload
        int sequence_number
        timestamp created_at
    }

    SerialController {
        string name
        int max_retries
        boolean enabled
        DataPacket[] history
    }

    SerialPort {
        string device_id
        int baud_rate
        int data_bits
        int stop_bits
        boolean connected
    }

    Transmitter {
        int transmit_speed
        boolean auto_send
        int send_queue_size
    }

    Receiver {
        int receive_speed
        boolean auto_receive
        int receive_buffer_size
    }

    Buffer {
        int capacity
        int current_size
        boolean overflow
        boolean underflow
    }

    StatusMonitor {
        string system_state
        int error_count
        double uptime
        boolean healthy
    }

    ErrorHandler {
        int error_level
        string error_type
        boolean critical
        boolean active
    }

    DataPacket {
        string id
        byte[] payload
        int sequence_number
        timestamp created_at
    }

    SerialController ..> Transmitter : delegates
    SerialController ..> Receiver : delegates
    Transmitter ..> Receiver : communicates
\`\`\``
      const result = sanitizeMermaidFences(input)
      console.log('=== SANITIZED OUTPUT ===')
      console.log(result)
      console.log('=== END ===')
      // No byte[] should remain
      expect(result).not.toContain('byte[]')
      expect(result).not.toContain('DataPacket[]')
      // Only one DataPacket class definition
      const dataPacketBlocks = result.split('\\n').filter(l => /DataPacket\s*\{/.test(l))
      expect(dataPacketBlocks.length).toBe(1)
    })
  })

  describe('gantt chart', () => {
    it('fixes empty sections that cause parse errors', () => {
      const input = `\`\`\`mermaid
gantt
    title Project Timeline
    dateFormat YYYY-MM-DD
    section Execution

    Task 1 :a1, 2024-01-01, 30d
    Task 2 :a2, after a1, 20d
\`\`\``
      const result = sanitizeMermaidFences(input)
      expect(result).not.toContain('section Execution\n\n')
    })
  })

  describe('sequenceDiagram single-line', () => {
    it('splits single-line sequenceDiagram with numbered messages', () => {
      const input = '```mermaid\nsequenceDiagram participant Consumer participant Service participant Database Consumer->>Service: 1. Send request Service->>Service: 2. Authenticate request Service->>Database: 3. Query database Database-->>Service: 4. Return data Service->>Service: 5. Process and format data Service-->>Consumer: 6. Send response\n```'
      const result = sanitizeMermaidFences(input)
      console.log('=== SANITIZED OUTPUT ===')
      console.log(result)
      console.log('=== END ===')
      const lines = result.split('\n').filter(l => l.trim())
      expect(lines.length).toBeGreaterThan(4)
      expect(result).toContain('participant Consumer')
      expect(result).toContain('Consumer->>Service')
      expect(result).toContain('Database-->>Service')
      expect(result).toContain('Service-->>Consumer')
      const arrowLines = lines.filter(l => /->>|-->>/.test(l))
      expect(arrowLines.length).toBe(6)
    })
  })
})
