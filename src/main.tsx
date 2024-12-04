import React, { useCallback, useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import axios from 'axios'
import { v4 as uuidv4 } from 'uuid'

import { SimliClient } from './SimliClient'

// Log environment variables
console.log('=== Environment Variables ===')
console.log('Raw SIMLI_API_KEY:', import.meta.env.VITE_SIMLI_API_KEY)
console.log('Type of SIMLI_API_KEY:', typeof import.meta.env.VITE_SIMLI_API_KEY)
console.log('SIMLI_API_KEY length:', import.meta.env.VITE_SIMLI_API_KEY?.length)

const sk = import.meta.env.VITE_SIMLI_API_KEY
console.log('sk after assignment:', {
  value: sk,
  type: typeof sk,
  length: sk?.length
})

const e11 = import.meta.env.VITE_ELEVENLABS_API_KEY

const completionEndpoint = import.meta.env?.VITE_COMPLETION_ENDPOINT || 'http://localhost:3000'

import './styles.css'

const AGENT_ID = 'b850bc30-45f8-0041-a00a-83df46d8555d'
const SIMLI_FACE_ID = '370b1e0f-86b9-4040-aaba-dab636f11f53'
const ELEVENLABS_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'

// Log constants
console.log('Using constants:', {
  AGENT_ID,
  SIMLI_FACE_ID,
  ELEVENLABS_VOICE_ID
})

const simliClient = new SimliClient()

const App = () => {
  const [inputText, setInputText] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState('')
  const [_, setChatgptText] = useState('')
  const [startWebRTC, setStartWebRTC] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const cancelTokenRef = useRef<any | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const audioContextRef = useRef<any | null>(null)
  const analyserRef = useRef<any | null>(null)
  const microphoneRef = useRef<any | null>(null)

  // TODO: populate these from localStorage if roomid and useruuid are set, otherwise generate a random uuid
  const [roomID, setRoomID] = useState('')
  const [userUUID, setUserUUID] = useState('')

  useEffect(() => {
    const storedRoomID = localStorage.getItem('roomID')
    const storedUserUUID = localStorage.getItem('userUUID')
    if (storedRoomID && storedUserUUID) {
      setRoomID(storedRoomID)
      setUserUUID(storedUserUUID)
    } else {
      const newRoomID = uuidv4()
      const newUserUUID = uuidv4()
      setRoomID(newRoomID)
      setUserUUID(newUserUUID)
      localStorage.setItem('roomID', newRoomID)
      localStorage.setItem('userUUID', newUserUUID)
    }
  }, [])

  const initializeSimliClient = useCallback(() => {
    if (videoRef.current && audioRef.current) {
      console.log('=== Initializing SimliClient ===')
      console.log('sk before config:', {
        value: sk,
        type: typeof sk,
        length: sk?.length
      })

      const SimliConfig = {
        apiKey: sk,
        faceID: SIMLI_FACE_ID,
        handleSilence: true,
        videoRef: videoRef,
        audioRef: audioRef,
      }

      console.log('SimliConfig created:', {
        apiKey: SimliConfig.apiKey ? `[SET: ${SimliConfig.apiKey.length} chars]` : '[NOT SET]',
        faceID: SimliConfig.faceID,
        handleSilence: SimliConfig.handleSilence
      })

      simliClient.Initialize(SimliConfig)
    }
  }, [])

  const handleStart = useCallback(() => {
    simliClient.start()
    setStartWebRTC(true)
    setIsLoading(true)
    setIsConnecting(true)
  }, [])

  useEffect(() => {
    initializeSimliClient()

    const handleConnected = () => {
      console.log('SimliClient is now connected!')
    }

    const handleDisconnected = () => {
      console.log('SimliClient has disconnected!')
    }

    const handleFailed = () => {
      console.log('SimliClient has failed to connect!')
      setError('Failed to connect to Simli. Please try again.')
    }

    const handleStarted = () => {
      console.log('SimliClient has started!')
      setIsLoading(false)
      setIsConnecting(false)

      // Send initial audio data after we get the started event
      const audioData = new Uint8Array(6000).fill(0)
      simliClient.sendAudioData(audioData)
    }

    simliClient.on('connected', handleConnected)
    simliClient.on('disconnected', handleDisconnected)
    simliClient.on('failed', handleFailed)
    simliClient.on('started', handleStarted)

    return () => {
      simliClient.off('connected', handleConnected)
      simliClient.off('disconnected', handleDisconnected)
      simliClient.off('failed', handleFailed)
      simliClient.off('started', handleStarted)
      simliClient.close()
    }
  }, [initializeSimliClient])

  const processInput = useCallback(async (text: any) => {
    setIsLoading(true)
    setError('')

    if (cancelTokenRef.current) {
      cancelTokenRef.current.cancel('Operation canceled by the user.')
    }

    cancelTokenRef.current = axios.CancelToken.source()

    try {
      console.log('sending input to chatgpt')
      const chatGPTResponse = await axios.post(
        completionEndpoint + `/${AGENT_ID}/message`,
        {
          text,
          roomId: roomID,
          userId: userUUID,
          userName: 'User',
        },
        {
          cancelToken: cancelTokenRef.current.token,
        }
      )

      console.log('chatGPTResponse', chatGPTResponse)

      const chatGPTText = chatGPTResponse.data[0].text
      if (!chatGPTText || chatGPTText.length === 0) {
        setError('No response from chatGPT. Please try again.')
        return
      }
      setChatgptText(chatGPTText)

      const elevenlabsResponse = await axios.post(
        `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}?output_format=pcm_16000`,
        {
          text: chatGPTText,
          model_id: 'eleven_turbo_v2_5',
        },
        {
          headers: {
            'xi-api-key': e11,
            'Content-Type': 'application/json',
          },
          responseType: 'arraybuffer',
          cancelToken: cancelTokenRef.current.token,
        }
      )

      const pcm16Data = new Uint8Array(elevenlabsResponse.data)
      const chunkSize = 6000
      for (let i = 0; i < pcm16Data.length; i += chunkSize) {
        const chunk = pcm16Data.slice(i, i + chunkSize)
        simliClient.sendAudioData(chunk)
      }
    } catch (err) {
      if (axios.isCancel(err)) {
        console.log('Request canceled:', err.message)
      } else {
        setError('An error occurred. Please try again.')
        console.error(err)
      }
    } finally {
      setIsLoading(false)
      cancelTokenRef.current = null
    }
  }, [roomID, userUUID])

  const toggleListening = useCallback(() => {
    if (isListening) {
      console.log('Stopping mic')
      stopListening()
    } else {
      console.log('Starting mic')
      startListening()
    }
  }, [isListening])

  const sendAudioToWhisper = useCallback(
    async (audioBlob: Blob) => {
      const formData = new FormData()
      formData.append('file', audioBlob, 'audio.wav')

      try {
        const response = await axios.post(`${completionEndpoint}/${AGENT_ID}/whisper`, formData, {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        })

        const transcribedText = response.data.text
        await processInput(transcribedText)
      } catch (error) {
        console.error('Error transcribing audio:', error)
        setError('Error transcribing audio. Please try again.')
      }
    },
    [processInput]
  )

  const startListening = useCallback(() => {
    setIsListening(true)
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        if (!audioContextRef.current) {
          audioContextRef.current = new (window.AudioContext ||
            (window as any).webkitAudioContext)()
        }

        if (!analyserRef.current) {
          analyserRef.current = audioContextRef.current.createAnalyser()
          analyserRef.current.fftSize = 512
        }

        if (microphoneRef.current) {
          microphoneRef.current.disconnect()
        }

        microphoneRef.current = audioContextRef.current.createMediaStreamSource(stream)
        microphoneRef.current.connect(analyserRef.current)

        mediaRecorderRef.current = new MediaRecorder(stream)
        mediaRecorderRef.current.ondataavailable = (event) => {
          console.log('Data available:', event.data)
          chunksRef.current.push(event.data)
        }
        mediaRecorderRef.current.onstop = () => {
          console.log('Recorder stopped')
          const audioBlob = new Blob(chunksRef.current, { type: 'audio/wav' })
          chunksRef.current = []
          sendAudioToWhisper(audioBlob)
        }
        mediaRecorderRef.current.start()
      })
      .catch((error) => {
        console.error('Error accessing microphone:', error)
        setError('Error accessing microphone. Please check your permissions.')
        setIsListening(false)
      })
  }, [sendAudioToWhisper])

  const stopListening = useCallback(() => {
    setIsListening(false)
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    if (microphoneRef.current) {
      microphoneRef.current.disconnect()
    }
  }, [])

  return (
    <div className="container">
      <div className="video-container">
        <video ref={videoRef} autoPlay playsInline muted className="video" />
        <audio ref={audioRef} autoPlay playsInline />
      </div>

      <div className="controls">
        {!startWebRTC ? (
          <button onClick={handleStart} disabled={isLoading} className="start-button">
            {isLoading ? 'Starting...' : 'Start'}
          </button>
        ) : (
          <>
            <div className="input-container">
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Type your message..."
                className="input-field"
                disabled={isLoading}
              />
              <button
                onClick={() => processInput(inputText)}
                disabled={isLoading || !inputText}
                className="send-button"
              >
                {isLoading ? 'Sending...' : 'Send'}
              </button>
            </div>
            <button
              onClick={toggleListening}
              className={`mic-button ${isListening ? 'active' : ''}`}
              disabled={isLoading}
            >
              {isListening ? 'Stop Recording' : 'Start Recording'}
            </button>
          </>
        )}
      </div>

      {error && <div className="error">{error}</div>}
      {isConnecting && <div className="connecting">Connecting to Simli...</div>}
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
