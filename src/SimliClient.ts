import { EventEmitter } from 'eventemitter3'
import axios from 'axios'

export interface SimliClientConfig {
  apiKey: string
  faceId: string
  handleSilence: boolean
  videoRef: React.RefObject<HTMLVideoElement>
  audioRef: React.RefObject<HTMLAudioElement>
}

export class SimliClient extends EventEmitter {
  private pc: RTCPeerConnection | null = null
  private dc: RTCDataChannel | null = null
  private dcInterval: NodeJS.Timeout | null = null
  private candidateCount: number = 0
  private prevCandidateCount: number = -1
  private apiKey: string = ''
  private faceId: string = ''
  private handleSilence: boolean = true
  private videoRef: React.RefObject<HTMLVideoElement> | null = null
  private audioRef: React.RefObject<HTMLAudioElement> | null = null

  constructor() {
    super()
    console.log('SimliClient constructor called')
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', this.handleBeforeUnload)
      window.addEventListener('pagehide', this.handlePageHide)
    }
  }

  public Initialize(config: SimliClientConfig) {
    console.log('=== SimliClient.Initialize START ===')
    console.log('Config received:', {
      apiKey: config.apiKey ? `[SET: ${config.apiKey.length} chars]` : '[NOT SET]',
      faceId: config.faceId,
      handleSilence: config.handleSilence
    })

    // Store values
    this.apiKey = config.apiKey
    this.faceId = config.faceId
    this.handleSilence = config.handleSilence
    this.videoRef = config.videoRef
    this.audioRef = config.audioRef

    // Log stored values
    console.log('Values stored in SimliClient:', {
      apiKey: this.apiKey ? `[SET: ${this.apiKey.length} chars]` : '[NOT SET]',
      faceId: this.faceId,
      handleSilence: this.handleSilence
    })
    console.log('=== SimliClient.Initialize END ===')
  }

  private createPeerConnection() {
    const config: RTCConfiguration = {
      iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }],
    }
    console.log('Creating peer connection with config:', config)

    this.pc = new window.RTCPeerConnection(config)

    if (this.pc) {
      this.setupPeerConnectionListeners()
    }
  }

  private setupPeerConnectionListeners() {
    if (!this.pc) return

    this.pc.addEventListener('icegatheringstatechange', () => {
      console.log('ICE gathering state changed: ', this.pc?.iceGatheringState)
    })

    this.pc.addEventListener('iceconnectionstatechange', () => {
      console.log('ICE connection state changed: ', this.pc?.iceConnectionState)
    })

    this.pc.addEventListener('signalingstatechange', () => {
      console.log('Signaling state changed: ', this.pc?.signalingState)
    })

    this.pc.addEventListener('track', (evt) => {
      console.log('Track event received:', evt.track.kind)
      if (evt.track.kind === 'video' && this.videoRef?.current) {
        this.videoRef.current.srcObject = evt.streams[0]
      } else if (evt.track.kind === 'audio' && this.audioRef?.current) {
        this.audioRef.current.srcObject = evt.streams[0]
      }
    })

    this.pc.onicecandidate = (event) => {
      if (event.candidate === null) {
        console.log('ICE gathering complete, local description:', JSON.stringify(this.pc?.localDescription))
      } else {
        console.log('New ICE candidate:', event.candidate)
        this.candidateCount += 1
      }
    }
  }

  async start() {
    console.log('Starting SimliClient...')
    await this.createPeerConnection()

    const parameters = { ordered: true }
    console.log('Creating data channel with parameters:', parameters)
    this.dc = this.pc!.createDataChannel('chat', parameters)

    this.setupDataChannelListeners()
    console.log('Adding transceivers...')
    this.pc?.addTransceiver('audio', { direction: 'recvonly' })
    this.pc?.addTransceiver('video', { direction: 'recvonly' })

    await this.negotiate()
  }

  private setupDataChannelListeners() {
    if (!this.dc) return

    this.dc.addEventListener('close', () => {
      console.log('Data channel closed')
      this.emit('disconnected')
      this.stopDataChannelInterval()
    })

    this.dc.addEventListener('open', async () => {
      console.log('Data channel opened')
      this.emit('connected')
      await this.initializeSession()

      this.startDataChannelInterval()
    })

    this.dc.addEventListener('message', (evt) => {
      console.log('Received message:', evt.data)

      if (evt.data.includes('START')) {
        console.log('Received START signal')
        this.emit('started')
      }

      if (evt.data === 'Session Intialization not done, Ignoring audio') {
        console.log('Session initialization failed')
        this.emit('failed')
      }
    })
  }

  private startDataChannelInterval() {
    this.stopDataChannelInterval() // Clear any existing interval
    this.dcInterval = setInterval(() => {
      this.sendPingMessage()
    }, 1000)
  }

  private stopDataChannelInterval() {
    if (this.dcInterval) {
      clearInterval(this.dcInterval)
      this.dcInterval = null
    }
  }

  private sendPingMessage() {
    if (this.dc && this.dc.readyState === 'open') {
      const message = 'ping ' + Date.now()
      try {
        this.dc.send(message)
      } catch (error) {
        console.error('Failed to send message:', error)
        this.stopDataChannelInterval()
      }
    } else {
      console.warn('Data channel is not open. Current state:', this.dc?.readyState)
      this.stopDataChannelInterval()
    }
  }

  private async initializeSession() {
    console.log('=== initializeSession START ===')
    console.log('Current SimliClient state:', {
      apiKey: this.apiKey ? `[SET: ${this.apiKey.length} chars]` : '[NOT SET]',
      faceId: this.faceId,
      handleSilence: this.handleSilence
    })

    const metadata = {
      faceId: this.faceId,
      isJPG: false,
      apiKey: this.apiKey,
      syncAudio: true,
      handleSilence: this.handleSilence,
    }

    console.log('Metadata prepared:', {
      ...metadata,
      apiKey: metadata.apiKey ? `[SET: ${metadata.apiKey.length} chars]` : '[NOT SET]'
    })

    try {
      console.log('Sending request to startAudioToVideoSession...')
      const requestBody = JSON.stringify(metadata)
      console.log('Request body:', {
        length: requestBody.length,
        preview: requestBody.substring(0, 50) + '...',
        hasApiKey: requestBody.includes('"apiKey"'),
        hasFaceId: requestBody.includes('"faceId"')
      })

      const response = await fetch('https://api.simli.ai/startAudioToVideoSession', {
        method: 'POST',
        body: requestBody,
        headers: {
          'Content-Type': 'application/json'
        }
      })

      console.log('Response status:', response.status)
      const rawText = await response.text()
      console.log('Response text:', rawText)

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}, body: ${rawText}`)
      }

      // Parse the raw text as JSON
      const resJSON = JSON.parse(rawText)
      console.log('Parsed response:', resJSON)

      if (this.dc && this.dc.readyState === 'open') {
        console.log('Sending session token to data channel')
        this.dc.send(resJSON.session_token)
      } else {
        console.error('Data channel not open when trying to send session token')
        this.emit('failed')
      }
    } catch (error) {
      console.error('Failed to initialize session:', error)
      this.emit('failed')
    }
    console.log('=== initializeSession END ===')
  }

  private async negotiate() {
    if (!this.pc) {
      throw new Error('PeerConnection not initialized')
    }

    try {
      console.log('Creating offer...')
      const offer = await this.pc.createOffer()
      console.log('Setting local description...')
      await this.pc.setLocalDescription(offer)

      console.log('Waiting for ICE gathering...')
      await this.waitForIceGathering()

      const localDescription = this.pc.localDescription
      if (!localDescription) {
        console.error('No local description available')
        return
      }

      console.log('Sending WebRTC session request...')
      const response = await fetch('https://api.simli.ai/StartWebRTCSession', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sdp: localDescription.sdp,
          type: localDescription.type,
          video_transform: 'none',
        }),
      })

      if (!response.ok) {
        console.error('WebRTC session error:', response.status, response.statusText)
        const text = await response.text()
        console.error('Error response:', text)
        this.emit('failed')
        return
      }

      const answer = await response.json()
      console.log('Setting remote description...')
      await this.pc.setRemoteDescription(new RTCSessionDescription(answer))
    } catch (e) {
      console.error('Negotiation failed:', e)
      this.emit('failed')
    }
  }

  private async waitForIceGathering(): Promise<void> {
    if (!this.pc) return

    if (this.pc.iceGatheringState === 'complete') {
      return
    }

    return new Promise<void>((resolve) => {
      const checkIceCandidates = () => {
        if (
          this.pc?.iceGatheringState === 'complete' ||
          this.candidateCount === this.prevCandidateCount
        ) {
          console.log('ICE gathering complete')
          resolve()
        } else {
          this.prevCandidateCount = this.candidateCount
          setTimeout(checkIceCandidates, 250)
        }
      }

      checkIceCandidates()
    })
  }

  public sendAudioData(audioData: Uint8Array) {
    if (this.dc && this.dc.readyState === 'open') {
      try {
        this.dc.send(audioData)
      } catch (error) {
        console.error('Failed to send audio data:', error)
      }
    } else {
      console.warn('Data channel is not open. Current state:', this.dc?.readyState)
    }
  }

  public close() {
    this.stopDataChannelInterval()
    if (this.dc) {
      this.dc.close()
    }
    if (this.pc) {
      this.pc.close()
    }
  }

  private handleBeforeUnload = () => {
    this.close()
  }

  private handlePageHide = () => {
    this.close()
  }
}
