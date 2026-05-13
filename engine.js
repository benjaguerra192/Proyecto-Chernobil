/**
 * CHERNOBYL VR | ENGINE V9.0
 * Modular, Event-Driven Architecture
 * Managers: State, Audio, Canvas, UI, Hotspot, Scene, Input, App
 */

const DEBUG = new URLSearchParams(window.location.search).has('debug');

// ============================================================
// LOGGER
// ============================================================
const Log = {
    _el: null,
    init() { this._el = document.getElementById('telemetry'); },
    write(cat, msg, color = '#888') {
        const time = new Date().toLocaleTimeString();
        if (DEBUG) console.log(`[${cat}] ${msg}`);
        if (!this._el) return;
        const line = document.createElement('div');
        line.innerHTML = `<span style="color:#ff5500">[${time}]</span> <span style="color:${color}">[${cat}]</span> ${msg}`;
        this._el.prepend(line);
        // Trim log to avoid memory leak
        while (this._el.children.length > 60) this._el.removeChild(this._el.lastChild);
    },
    info(cat, msg)  { this.write(cat, msg, '#888'); },
    warn(cat, msg)  { this.write(cat, msg, '#ff9900'); },
    error(cat, msg) { this.write(cat, msg, '#ff4444'); },
    ok(cat, msg)    { this.write(cat, msg, '#44ff88'); },
};

// ============================================================
// STATE MANAGER - single source of truth
// ============================================================
const StateManager = {
    panoramas: [],
    currentId: null,
    vrActive: false,
    transitioning: false,
    modalOpen: false,
    sidebarOpen: false,

    set(key, val) {
        const prev = this[key];
        this[key] = val;
        if (DEBUG && prev !== val) Log.info('STATE', `${key}: ${prev} -> ${val}`);
        window.dispatchEvent(new CustomEvent('stateChange', { detail: { key, val, prev } }));
    },
    lock()   { this.set('transitioning', true); },
    unlock() { this.set('transitioning', false); },
};

// ============================================================
// EVENT BUS - decoupled communication
// ============================================================
const Bus = {
    emit(name, detail = {}) {
        Log.info('BUS', `emit:${name}`);
        window.dispatchEvent(new CustomEvent(name, { detail }));
    },
    on(name, fn) {
        window.addEventListener(name, (e) => fn(e.detail));
    },
};

// ============================================================
// AUDIO MANAGER - Web Audio API & Ambient Tracks
// ============================================================
const AudioManager = {
    _ready: false,
    _ctx: null,
    _ambient: null,
    _voice: null,
    _currentTrack: null,
    _currentVoice: null,
    _lastVoiceStart: 0,
    _fadeIntervals: new WeakMap(),
    SUBTITLES: {
        voz_menu_principal: 'Frente al reactor cuatro queda el sarc\u00f3fago. Fue una respuesta de emergencia para encerrar radiaci\u00f3n, polvo y restos del n\u00facleo.',
        voz_control_1: 'Sala de control, turno nocturno. La potencia cae m\u00e1s de lo previsto y los indicadores ya no cuentan una historia clara.',
        voz_control_2: 'Las alarmas empiezan a cruzarse. Hay canales inestables y una presi\u00f3n que sube demasiado r\u00e1pido para corregirla desde la consola.',
        voz_control_3: 'Aqu\u00ed la confusi\u00f3n se vuelve f\u00edsica. Un operador pide bajar potencia, otro confirma el procedimiento, y el reactor ya est\u00e1 fuera de control.',
        voz_control_3_danio: 'Despu\u00e9s del incendio, la sala deja de parecer un lugar de mando. Cables, metal quemado y polvo radiactivo vuelven peligroso cada paso.',
        voz_barras_control: 'Esta es la tapa superior del reactor RBMK. Cada punto marca un canal: combustible, sensores o barras de control.',
        voz_explosion: 'En segundos, el vapor rompe la estructura. La tapa del reactor se desplaza, los canales se abren y el grafito caliente queda expuesto.',
        voz_techo_reactor: 'En el techo, los fragmentos negros no son escombros comunes: son grafito del n\u00facleo. Cada pedazo emite una dosis enorme.',
        voz_pie_elefante: 'El pie de elefante es corium solidificado: combustible, arena, metal y hormig\u00f3n fundidos juntos. Acercarse demasiado pod\u00eda ser mortal.'
    },
    
    // Scene to audio mapping
    _tracks: {
        'menu_principal.png':         './Audios/menu_principal.mp3',
        'control_room_1.png':         './Audios/control-rooms.mp3',
        'control_room_2.png':         './Audios/panic.mp3',
        'control_room_3.png':         './Audios/control-rooms.mp3',
        'control_room_3_quemado.png': './Audios/radiation.mp3',
        'reactor_control_rods_zone.png': './Audios/radiation.mp3',
        'reactor_explosion_moment.png': './Audios/caos.mp3',
        'reactor_roof.png':           './Audios/radiation.mp3',
        'elephants_foot.png':         './Audios/radiation.mp3',
        'pripyat_ferris_wheel.png':   './Audios/radiation.mp3'
    },

    init() {
        if (this._ready) return;
        this._ready = true;
        try {
            this._ctx = new (window.AudioContext || window.webkitAudioContext)();
        } catch(e) {
            Log.warn('AUDIO', 'WebAudio API not supported');
        }
        
        this._ambient = new Audio();
        this._ambient.loop = true;
        this._ambient.volume = 0.25;
        
        this._voice = new Audio();
        this._voice.loop = false;
        
        this._voice.addEventListener('ended', () => {
            this._currentVoice = null;
            if (typeof SubtitleManager !== 'undefined') SubtitleManager.hide();
            this.fadeVolume(this._ambient, 0.25, 1000);
        });

        Log.ok('AUDIO', 'Initialized');
    },

    click() {
        if (!this._ctx) return;
        if (this._ctx.state === 'suspended') this._ctx.resume();
        const osc = this._ctx.createOscillator();
        const gain = this._ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(800, this._ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(300, this._ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.3, this._ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this._ctx.currentTime + 0.1);
        osc.connect(gain);
        gain.connect(this._ctx.destination);
        osc.start();
        osc.stop(this._ctx.currentTime + 0.1);
    },

    playAmbient(sceneId) {
        if (!this._ready) return;
        const track = this._tracks[sceneId] || './Audios/control-rooms.mp3';
        
        if (this._currentTrack === track) return;
        this._currentTrack = track;
        
        if (!this._ambient.paused) {
            this.fadeVolume(this._ambient, 0, 800).then(() => {
                this._ambient.src = track;
                this._ambient.play().catch(e => Log.warn('AUDIO', 'Autoplay blocked'));
                this.fadeVolume(this._ambient, 0.25, 800);
            });
        } else {
            this._ambient.src = track;
            this._ambient.volume = 0;
            this._ambient.play().catch(e => Log.warn('AUDIO', 'Autoplay blocked'));
            this.fadeVolume(this._ambient, 0.25, 800);
        }
        Log.info('AUDIO', `Ambient track swapped to ${track}`);
    },

    playVoice(voiceId) {
        if (!this._ready) return;
        const now = Date.now();
        if (this._currentVoice === voiceId && this._voice && !this._voice.paused) return;
        if (now - this._lastVoiceStart < 350) return;
        this._lastVoiceStart = now;
        this._currentVoice = voiceId;
        
        // Lower ambient volume
        if (!this._ambient.paused) {
            this.fadeVolume(this._ambient, 0.08, 500);
        }
        
        if (this._voice && !this._voice.paused) {
            this._voice.pause();
            this._voice.currentTime = 0;
        }
        this._voice.src = `./Audios/${voiceId}.mp3`;
        this._voice.volume = 1.0;
        if (typeof SubtitleManager !== 'undefined') SubtitleManager.show(voiceId, this.SUBTITLES[voiceId]);
        this._voice.play().catch(e => {
            this._currentVoice = null;
            if (typeof SubtitleManager !== 'undefined') SubtitleManager.hide();
            Log.warn('AUDIO', 'Voice autoplay blocked');
            this.fadeVolume(this._ambient, 0.25, 500);
        });
        Log.info('AUDIO', `Playing voice: ${voiceId}`);
    },

    stopVoice() {
        this._currentVoice = null;
        if (!this._voice || this._voice.paused) return;
        this._voice.pause();
        this._voice.currentTime = 0;
        if (typeof SubtitleManager !== 'undefined') SubtitleManager.hide();
        this.fadeVolume(this._ambient, 0.25, 500);
        Log.info('AUDIO', 'Voice stopped');
    },

    fadeVolume(audioObj, targetVolume, duration) {
        return new Promise((resolve) => {
            if (!audioObj) {
                resolve();
                return;
            }
            const startVol = audioObj.volume;
            const change = targetVolume - startVol;
            const steps = 20;
            const stepTime = duration / steps;
            let currentStep = 0;
            
            clearInterval(this._fadeIntervals.get(audioObj));
            
            const fadeInterval = setInterval(() => {
                currentStep++;
                let newVol = startVol + (change * (currentStep / steps));
                audioObj.volume = Math.max(0, Math.min(1, newVol));
                
                if (currentStep >= steps) {
                    clearInterval(fadeInterval);
                    this._fadeIntervals.delete(audioObj);
                    audioObj.volume = targetVolume;
                    resolve();
                }
            }, stepTime);
            this._fadeIntervals.set(audioObj, fadeInterval);
        });
    },

    stopAmbient() {
        if (this._ambient) {
            this.fadeVolume(this._ambient, 0, 500).then(() => this._ambient.pause());
        }
    },
};

// ============================================================
// CANVAS RENDERER - generates texture data URLs
// ============================================================
const CanvasRenderer = {
    generate(text, opts = {}) {
        const w = opts.w || 512, h = opts.h || 128;
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, w, h);
        
        if (opts.glow) {
            ctx.shadowColor = opts.glowColor || opts.color || '#ffffff';
            ctx.shadowBlur = opts.glow;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;
        }

        ctx.fillStyle = opts.color || '#fff';
        const fontFam = opts.family || '"Inter", sans-serif';
        ctx.font = `${opts.weight || '700'} ${opts.size || '40px'} ${fontFam}`;
        ctx.textAlign = opts.align || 'center';
        ctx.textBaseline = 'middle';
        
        const x = opts.align === 'left' ? 40 : w / 2;
        
        if (opts.wrap && text.length > 20) {
            this._wrap(ctx, text, x, h / 2, w - 80, parseInt(opts.size) * 1.3 || 50);
        } else {
            ctx.fillText(text, x, h / 2);
        }
        return canvas.toDataURL();
    },
    _wrap(ctx, text, x, y, maxW, lh) {
        const words = text.split(' ');
        let line = '', lines = [];
        for (const word of words) {
            const test = line + word + ' ';
            if (ctx.measureText(test).width > maxW && line) { lines.push(line.trim()); line = word + ' '; }
            else line = test;
        }
        lines.push(line.trim());
        const startY = y - ((lines.length - 1) * lh) / 2;
        lines.forEach((l, i) => ctx.fillText(l, x, startY + i * lh));
    },
    roundedPanel(opts = {}) {
        const w = opts.w || 1024;
        const h = opts.h || 512;
        const r = Math.max(6, Math.min(opts.radius || 34, Math.floor(Math.min(w, h) / 2)));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, w, h);

        const drawRoundedPath = () => {
            ctx.beginPath();
            ctx.moveTo(r, 0);
            ctx.lineTo(w - r, 0);
            ctx.quadraticCurveTo(w, 0, w, r);
            ctx.lineTo(w, h - r);
            ctx.quadraticCurveTo(w, h, w - r, h);
            ctx.lineTo(r, h);
            ctx.quadraticCurveTo(0, h, 0, h - r);
            ctx.lineTo(0, r);
            ctx.quadraticCurveTo(0, 0, r, 0);
            ctx.closePath();
        };

        const grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, opts.top || 'rgba(10,12,18,0.96)');
        grad.addColorStop(1, opts.bottom || 'rgba(3,3,3,0.92)');
        drawRoundedPath();
        ctx.fillStyle = grad;
        ctx.fill();

        drawRoundedPath();
        ctx.strokeStyle = opts.stroke || 'rgba(255,255,255,0.15)';
        ctx.lineWidth = Math.max(1, opts.border || 2);
        ctx.stroke();

        return canvas.toDataURL();
    },
};

// ============================================================
// SUBTITLE MANAGER - camera-fixed captions for VR/Cardboard
// ============================================================
const SubtitleManager = {
    enabled: true,
    _activeText: '',
    _textureCache: new Map(),

    toggle() {
        this.enabled = !this.enabled;
        this._updateToggleLabel();
        if (this.enabled && this._activeText) this._render(this._activeText);
        else this.hide({ keepText: true });
    },

    show(voiceId, text) {
        this._activeText = text || '';
        if (!this.enabled || !this._activeText) {
            this.hide({ keepText: true });
            return;
        }
        this._render(this._activeText);
    },

    hide(opts = {}) {
        const panel = document.getElementById('vr-caption-panel');
        if (panel) panel.setAttribute('visible', 'false');
        if (!opts.keepText) this._activeText = '';
    },

    _render(text) {
        const panel = document.getElementById('vr-caption-panel');
        const txt = document.getElementById('vr-caption-txt');
        if (!panel || !txt) return;
        const tex = this._getTexture(text);
        txt.setAttribute('material', tex);
        panel.setAttribute('visible', 'true');
    },

    _getTexture(text) {
        if (this._textureCache.has(text)) return this._textureCache.get(text);
        const img = CanvasRenderer.generate(text, {
            w: 2200, h: 420, size: '78px', color: '#ffffff',
            family: '"Inter", sans-serif', weight: '700', wrap: true
        });
        const tex = `src: url(${img}); transparent: true; shader: flat; alphaTest: 0.5`;
        this._textureCache.set(text, tex);
        return tex;
    },

    _updateToggleLabel() {
        const el = document.getElementById('menu-subtitles-txt');
        if (!el) return;
        const label = this.enabled ? 'SUB' : 'OFF';
        const color = this.enabled ? '#44ff88' : '#888888';
        const img = CanvasRenderer.generate(label, {
            w: 400, h: 180, size: '82px', color,
            family: '"JetBrains Mono", monospace', weight: '700', glow: this.enabled ? 7 : 0
        });
        el.setAttribute('material', `src: url(${img}); transparent: true; shader: flat; alphaTest: 0.5`);
    }
};

// ============================================================
// SCENE CONFIG - per-scene camera/render tuning
// ============================================================
const SceneConfig = {
    'menu_principal.png':          { fov: 75 },
    'control_room_1.png':          { fov: 75 },
    'control_room_2.png':          { fov: 75 },
    'control_room_3.png':          { fov: 75 },
    'control_room_3_quemado.png':  { fov: 75 },
    'reactor_control_rods_zone.png': { fov: 74 },
    'reactor_explosion_moment.png': { fov: 78 },
    'reactor_roof.png':            { fov: 72 },
    'elephants_foot.png':          { fov: 75 },
    'pripyat_ferris_wheel.png':    { fov: 75 },
};

// ============================================================
// HOTSPOT DATABASE - compositionally placed per scene
// ============================================================
const HotspotDB = {
    'menu_principal.png': [
        { type: 'info', pos: '0 0.3 -3', title: 'SARC\u00d3FAGO', desc: 'Estructura de contenci\u00f3n construida en 206 d\u00edas por 600.000 trabajadores.' },
        { type: 'info', pos: '-3 -0.2 -1', title: 'ZONA DE EXCLUSI\u00d3N', desc: '\u00c1rea de 30 km de radio. Evacuada permanentemente.' },
        { type: 'audio', target: 'voz_menu_principal', pos: '2 0.15 -2.4', title: 'INICIO DEL RECORRIDO', desc: 'Introducci\u00f3n hablada para ubicar al visitante antes de entrar al reactor.' },
        { type: 'scene', target: 'control_room_1.png', pos: '0 -0.35 -3', title: 'ENTRAR A CONTROL', desc: 'Ir a la sala de control del Reactor 4.' },
    ],
    'control_room_1.png': [
        { type: 'audio', target: 'voz_control_1', pos: '-1.5 0.1 -3', title: 'CONSOLA AZ-5', desc: 'Bot\u00f3n de parada de emergencia. Al presionarlo a la 1:23 AM se inici\u00f3 la reacci\u00f3n en cadena.' },
        { type: 'info', pos: '2 0.2 -2', title: 'PANEL DE REFRIGERACION', desc: 'Bombas de circulacion del refrigerante. La falta de caudal provoco sobrecalentamiento.' },
        { type: 'info', pos: '-1.8 -0.4 -2', title: 'BITACORAS', desc: 'Registros de los operadores. Demuestran que el reactor operaba en inestabilidad total.' },
        { type: 'scene', target: 'reactor_control_rods_zone.png', pos: '-2.4 0.35 -2.3', title: 'ZONA DE BARRAS', desc: 'Ir a la tapa superior del reactor, donde estaban los canales y barras de control.' },
    ],
    'control_room_2.png': [
        { type: 'info', pos: '-2 0.5 -2', title: 'ALARMAS INHABILITADAS', desc: 'Panel de avisos sonoros. Los operadores desconectaron las alarmas.' },
        { type: 'audio', target: 'voz_control_2', pos: '1.5 0 -3', title: 'LECTURAS T\u00c9RMICAS', desc: 'Indicadores anal\u00f3gicos de temperatura. Varios clavados en su valor m\u00e1ximo.' },
        { type: 'scene', target: 'reactor_control_rods_zone.png', pos: '-2.2 -0.2 -2.5', title: 'ZONA DE BARRAS', desc: 'Ir a la zona fisica de los canales de barras sobre el reactor.' },
    ],
    'control_room_3.png': [
        { type: 'info', pos: '-1.5 0.3 -3', title: 'PANELES DE CONTROL', desc: 'Instrumentos de monitoreo del reactor adyacente.' },
        { type: 'info', pos: '2 -0.1 -2', title: 'COMUNICACIONES', desc: 'Terminal de comunicacion interna. Primeras llamadas de emergencia.' },
        { type: 'audio', target: 'voz_control_3', pos: '0 0.2 -3', title: '\u00d3RDENES CRUZADAS', desc: 'Di\u00e1logo de operadores intentando entender qu\u00e9 ocurr\u00eda en la unidad contigua.' },
        { type: 'scene', target: 'control_room_3_quemado.png', pos: '1.6 -0.35 -2.4', title: 'VER DA\u00d1O', desc: 'Ir a la misma zona luego del incendio.' },
    ],
    'control_room_3_quemado.png': [
        { type: 'audio', target: 'voz_control_3_danio', pos: '1 0 -3', title: 'MARCAS DE FUEGO', desc: 'Paredes carbonizadas por el incendio de grafito durante 10 d\u00edas.' },
        { type: 'info', pos: '-2 0.3 -1.5', title: 'CONTAMINACION', desc: 'Superficie con cesio-137 incrustado. Niveles mortales.' },
        { type: 'info', pos: '0 -0.35 -3', title: 'EQUIPOS INUTILIZADOS', desc: 'El calor, humo y polvo radiactivo dejaron instrumentos fuera de servicio o imposibles de leer.' },
    ],
    'reactor_control_rods_zone.png': [
        { type: 'info', pos: '0 -0.45 -3', title: 'TAPA DEL REACTOR', desc: 'Zona superior del RBMK. Bajo estas placas estaban los canales tecnologicos, las barras de control y el recorrido hacia el nucleo.' },
        { type: 'info', pos: '-1.8 -0.25 -2.5', title: 'CANALES DE BARRAS', desc: 'Cada abertura corresponde a un canal o posicion tecnica. Las barras absorbentes debian entrar por estos canales para frenar la reaccion.' },
        { type: 'info', pos: '1.7 -0.15 -2.6', title: 'NUCLEO BAJO LA LOSA', desc: 'El nucleo estaba debajo de esta superficie. Durante el accidente, la presion de vapor rompio canales y desplazo estructuras superiores.' },
        { type: 'audio', target: 'voz_barras_control', pos: '0 0.35 -3', title: 'LECTURA DE CANALES', desc: 'Audio contextual de operadores antes de la p\u00e9rdida de control.' },
        { type: 'scene', target: 'reactor_explosion_moment.png', pos: '2 0.25 -2.3', title: 'MOMENTO CRITICO', desc: 'Ir a la recreacion del instante de explosion.' },
    ],
    'reactor_explosion_moment.png': [
        { type: 'info', pos: '0 0.4 -3', title: 'PICO DE POTENCIA', desc: 'La potencia subio violentamente en segundos. El vapor destruyo canales y levanto la tapa del reactor.' },
        { type: 'info', pos: '2 0 -2.4', title: 'EXPLOSION DE VAPOR', desc: 'La primera explosion fue impulsada por presion de vapor. Luego el grafito expuesto empeoro la liberacion radiactiva.' },
        { type: 'audio', target: 'voz_explosion', pos: '-1.8 -0.1 -2.6', title: 'CAOS EN PLANTA', desc: 'Audio de emergencia para reforzar la escena del accidente.' },
        { type: 'info', pos: '0 -0.4 -2.8', title: 'GRAFITO EXPUESTO', desc: 'La ruptura dejo material del nucleo al aire. Eso intensifico incendios y liberacion de particulas.' },
        { type: 'scene', target: 'reactor_roof.png', pos: '1.6 0.35 -2.5', title: 'IR AL TECHO', desc: 'Ver la zona donde cayeron fragmentos de grafito.' },
    ],
    'reactor_roof.png': [
        { type: 'info', pos: '-1.5 -0.3 -3', title: 'RESTOS DE GRAFITO', desc: 'Fragmentos del nucleo. 10.000 rontgens por hora. Dosis letal en minutos.' },
        { type: 'info', pos: '2 0.6 -2', title: 'ZONA MASHA', desc: 'Area mas contaminada. Los robots fallaron por la radiacion.' },
        { type: 'audio', target: 'voz_techo_reactor', pos: '1.5 -0.6 -2.5', title: 'BIOROBOTS', desc: 'Liquidadores humanos. 90 segundos con palas en el techo.' },
        { type: 'info', pos: '0 0.15 -3', title: 'DOSIS LETAL', desc: 'En algunos puntos, permanecer mas de pocos minutos podia ser fatal. Las tareas se hicieron por turnos brevisimos.' },
        { type: 'scene', target: 'elephants_foot.png', pos: '-2 0.2 -2.2', title: 'BAJAR AL SOTANO', desc: 'Ir al recorrido del corium conocido como Pie de Elefante.' },
    ],
    'elephants_foot.png': [
        { type: 'info', pos: '1 -0.1 -3', title: 'CORIUM', desc: 'Masa fundida de uranio, grafito y hormigon. Temperatura interna de 300 grados.' },
        { type: 'info', pos: '-1.5 0.3 -2', title: 'RADIACION FANTASMA', desc: 'Grano fotografico distorsionado por particulas gamma.' },
        { type: 'info', pos: '1.5 -0.5 -2', title: 'HORMIGON FUNDIDO', desc: 'El corium fundio 2 metros de hormigon en el pasillo 217.' },
        { type: 'audio', target: 'voz_pie_elefante', pos: '-0.2 -0.25 -3', title: 'LECTURA IMPOSIBLE', desc: 'Di\u00e1logo para transmitir la dificultad de medir cerca del corium.' },
    ],
    'pripyat_ferris_wheel.png': [
        { type: 'info', pos: '0 0.8 -3', title: 'NORIA DE PRIPYAT', desc: 'Deb\u00eda inaugurarse el 1 de mayo de 1986. Jam\u00e1s fue utilizada.' },
        { type: 'info', pos: '-2.5 0 -1.5', title: 'CIUDAD FANTASMA', desc: 'Pripyat tenia 49.000 habitantes. Evacuada en 3 horas.' },
        { type: 'info', pos: '2 -0.3 -2', title: 'ZONA RECREATIVA', desc: 'Simbolo del progreso sovietico. Hoy icono del desastre.' },
    ],
};

// ============================================================
// SCENE DATABASE - Scene specific metadata
// ============================================================
const SceneDB = {
    'menu_principal.png':          { title: 'EL SARC\u00d3FAGO',               desc: 'Vista exterior del reactor 4 cubierto por el sarc\u00f3fago de hormig\u00f3n construido en 206 d\u00edas.' },
    'control_room_1.png':          { title: 'SALA DE CONTROL',            desc: 'Epicentro operativo del ensayo de seguridad que termin\u00f3 en desastre a la 01:23 AM.' },
    'control_room_2.png':          { title: 'PANELES DE SEGURIDAD',       desc: 'Sistemas de refrigeraci\u00f3n manuales. Todos los sistemas autom\u00e1ticos fueron desactivados.' },
    'control_room_3.png':          { title: 'SALA DE CONTROL ALTERADA',   desc: 'Recreaci\u00f3n de la sala durante la crisis: alarmas, \u00f3rdenes cruzadas y lecturas inestables.' },
    'control_room_3_quemado.png':  { title: 'SALA DE CONTROL 3 (DA\u00d1O)',   desc: 'Misma sala tras el incendio. Las paredes muestran marcas de radiacion extrema.' },
    'reactor_control_rods_zone.png': { title: 'ZONA DE BARRAS DE CONTROL', desc: 'Recreacion de la tapa superior del reactor RBMK: canales, barras de control y nucleo bajo la losa.' },
    'reactor_explosion_moment.png': { title: 'MOMENTO DE LA EXPLOSION',   desc: 'Recreacion del instante critico: aumento de potencia, vapor, fuego y ruptura del reactor.' },
    'reactor_roof.png':            { title: 'TECHO DEL REACTOR',          desc: 'El nivel mas letal. Los liquidadores trabajaron aqui recogiendo grafito altamente radiactivo.' },
    'elephants_foot.png':          { title: 'PIE DE ELEFANTE',            desc: 'Masa fundida de corium extremadamente radiactiva en el sotano del reactor.' },
    'pripyat_ferris_wheel.png':    { title: 'PARQUE DE PRIPYAT',          desc: 'La noria jamas inaugurada. La ciudad fue evacuada 36 horas despues del accidente.' },
};

// ============================================================
// HOTSPOT MANAGER - isolated lifecycle
// ============================================================
const HotspotManager = {
    POOL_SIZE: 5,
    _activeTooltip: null,
    _textureCache: new Map(),
    COLORS: {
        info: {
            base: '#ff5500',
            ring: '#ff9a66',
            hover: '#ffd8c4'
        },
        audio: {
            base: '#1f8cff',
            ring: '#7fc0ff',
            hover: '#d9edff'
        }
    },

    init() {
        const pool = document.getElementById('hotspot-pool');
        if (!pool) return;
        
        let _lastFire = 0;
        pool.addEventListener('click', (e) => {
            const now = Date.now();
            if (now - _lastFire < 600) return; // Debounce
            
            const closeBtn = e.target.closest('.hs-close-btn');
            if (closeBtn) {
                _lastFire = now;
                AudioManager.click();
                this.closeTooltip();
                return;
            }
            
            const hsRoot = e.target.closest('.hs-container');
            if (!hsRoot) return;
            
            _lastFire = now;
            Log.info('HOTSPOT', 'Click detected');
            const type = hsRoot.getAttribute('data-type');
            if (type === 'audio') {
                const trackId = hsRoot.getAttribute('data-target');
                if (trackId) AudioManager.playVoice(trackId);
            } else if (type === 'scene') {
                AudioManager.click();
                SceneManager.load(hsRoot.getAttribute('data-target'));
            } else {
                AudioManager.click();
                this.openTooltip(hsRoot);
            }
        });
        
        // Visual and Audio feedback on hover
        document.querySelectorAll('.hs-container').forEach(root => {
            root.querySelectorAll('.hs-core, .hs-ring1, .hs-hitbox, .hs-audio-tag').forEach(el => {
                el.removeAttribute('look-at');
            });

            const core = root.querySelector('.hs-core');
            if (core) {
                core.addEventListener('mouseenter', () => {
                    this._paint(root, true);
                    if (root.getAttribute('data-type') === 'audio' && !UIState.hotspotModalOpen) {
                        const trackId = root.getAttribute('data-target');
                        if (trackId) AudioManager.playVoice(trackId);
                    }
                });
                core.addEventListener('mouseleave', () => {
                    this._paint(root, false);
                    if (root.getAttribute('data-type') === 'audio' && !UIState.hotspotModalOpen) {
                        AudioManager.stopVoice();
                    }
                });
            }
        });
        Log.ok('HOTSPOT', 'Initialized contextual event delegation');
    },

    openTooltip(hsRoot) {
        if (hsRoot.getAttribute('data-type') === 'audio') {
            const trackId = hsRoot.getAttribute('data-target');
            if (trackId) AudioManager.playVoice(trackId);
            return;
        }
        if (this._activeTooltip && this._activeTooltip !== hsRoot) {
            this.closeTooltip();
        }
        this._activeTooltip = hsRoot;
        
        // Hide all hotspots physically to prevent overlap
        document.querySelectorAll('.hs-container.active-hs').forEach(hs => {
            hs.setAttribute('visible', 'false');
            hs.querySelectorAll('.hs-core, .hs-hitbox').forEach(el => el.classList.remove('interactable'));
        });

        // Inform Centralized UI State
        UIState.hotspotModalOpen = true;

        // Recenter ONLY the modal anchor so the main menu doesn't jump
        const cam = document.getElementById('player-cam');
        const modalAnchor = document.getElementById('modal-anchor');
        if (cam && modalAnchor) {
            const euler = new THREE.Euler().setFromQuaternion(cam.object3D.getWorldQuaternion(new THREE.Quaternion()), 'YXZ');
            modalAnchor.setAttribute('rotation', `0 ${(euler.y * 180) / Math.PI} 0`);
            const hotspotWorldPos = new THREE.Vector3();
            hsRoot.object3D.getWorldPosition(hotspotWorldPos);
            modalAnchor.setAttribute('position', `0 ${hotspotWorldPos.y} 0`);
        }

        // Setup centralized modal
        const modal = document.getElementById('vr-hotspot-modal');
        const titleTex = hsRoot.getAttribute('data-tex-title');
        const descTex = hsRoot.getAttribute('data-tex-desc');
        
        document.getElementById('modal-hs-title').setAttribute('material', titleTex);
        document.getElementById('modal-hs-desc').setAttribute('material', descTex);
        
        modal.setAttribute('visible', 'true');
        document.getElementById('modal-hs-close').classList.add('interactable');
        
        Log.ok('HOTSPOT', 'Opened centralized info panel');
        
        // Voice audio is now handled purely by hover (mouseenter/mouseleave).
        // Opening the tooltip hides the hotspot, triggering mouseleave and stopping the audio.
        // We do not auto-play audio on click here anymore.
        
        InputManager.refreshCursor();
    },
    
    closeTooltip() {
        if (!this._activeTooltip) return;
        
        // Hide modal
        const modal = document.getElementById('vr-hotspot-modal');
        modal.setAttribute('visible', 'false');
        document.getElementById('modal-hs-close').classList.remove('interactable');

        // Stop any currently playing voice audio
        AudioManager.stopVoice();

        // Restore active hotspots
        document.querySelectorAll('.hs-container.active-hs').forEach(hs => {
            hs.setAttribute('visible', 'true');
            hs.querySelectorAll('.hs-core, .hs-hitbox').forEach(el => el.classList.add('interactable'));
        });
        
        UIState.hotspotModalOpen = false;
        
        this._activeTooltip = null;
        InputManager.refreshCursor();
    },

    clear() {
        Log.info('HOTSPOT', 'Clearing all hotspots');
        this.closeTooltip();
        AudioManager.stopVoice();
        if (typeof InputManager !== 'undefined' && InputManager.clearAudioHover) InputManager.clearAudioHover();
        for (let i = 1; i <= this.POOL_SIZE; i++) {
            const root = document.getElementById('hs-' + i);
            if (root) {
                root.setAttribute('visible', 'false');
                root.setAttribute('position', '0 -1000 0'); // Move physically away
                root.classList.remove('active-hs');
                root.removeAttribute('data-type');
                root.removeAttribute('data-target');
                root.removeAttribute('data-tex-title');
                root.removeAttribute('data-tex-desc');
                root.querySelectorAll('.hs-core, .hs-hitbox').forEach(el => el.classList.remove('interactable'));
            }
        }
    },

    load(sceneId) {
        const pts = (HotspotDB[sceneId] || []).filter(pt => pt.type !== 'scene');
        Log.info('HOTSPOT', `Loading ${pts.length} hotspot(s) for ${sceneId}`);

        pts.forEach((pt, idx) => {
            if (idx >= this.POOL_SIZE) return;
            const root = document.getElementById('hs-' + (idx + 1));
            if (!root) return;

            // Inject data safely without cloning
            root.setAttribute('data-type', pt.type || 'info');
            root.setAttribute('data-target', pt.target || '');
            root.setAttribute('look-at', '#player-cam');
            
            const tag = root.querySelector('.hs-audio-tag');
            if (pt.type === 'audio') {
                if (tag) tag.setAttribute('visible', 'true');
            } else {
                if (tag) tag.setAttribute('visible', 'false');
            }

            if (pt.type !== 'scene') {
                const tex = this._getTextTextures(pt);
                root.setAttribute('data-tex-title', tex.title);
                root.setAttribute('data-tex-desc', tex.desc);
            }

            // Keep hotspots behind VR panels so menus always win the raycast.
            const pos = this._normalizePos(pt.pos, 2.35);
            root.setAttribute('position', pos);
            root.setAttribute('visible', 'true');
            root.classList.add('active-hs');
            this._paint(root, false);
            
            // Activate hitboxes
            root.querySelectorAll('.hs-core, .hs-hitbox').forEach(el => el.classList.add('interactable'));

            Log.ok('HOTSPOT', `HS-${idx + 1} positioned at ${pos}: "${pt.title}"`);
        });

        // Refresh raycaster just in case, though A-Frame tracks position updates automatically
        InputManager.refreshCursor();
    },

    lock() {
        Log.info('HOTSPOT', 'Locking (modal open)');
        document.querySelectorAll('.hs-core, .hs-hitbox').forEach(hs => {
            hs.classList.remove('interactable');
            if (hs.classList.contains('hs-core')) hs.setAttribute('material', 'opacity', '0.2');
        });
        InputManager.refreshCursor();
    },

    unlock() {
        Log.info('HOTSPOT', 'Unlocking (modal closed)');
        document.querySelectorAll('.hs-container.active-hs .hs-core, .hs-container.active-hs .hs-hitbox').forEach(hs => {
            hs.classList.add('interactable');
            if (hs.classList.contains('hs-core')) {
                hs.setAttribute('material', 'opacity', '0.9');
            }
        });
        document.querySelectorAll('.hs-container.active-hs').forEach((root) => this._paint(root, false));
        InputManager.refreshCursor();
    },

    _normalizePos(posStr, radius) {
        const p = posStr.split(' ').map(Number);
        const mag = Math.sqrt(p[0] ** 2 + p[1] ** 2 + p[2] ** 2) || 1;
        return `${(p[0] / mag) * radius} ${(p[1] / mag) * radius} ${(p[2] / mag) * radius}`;
    },

    _getTextTextures(pt) {
        const key = `${pt.title || ''}\n${pt.desc || ''}`;
        if (this._textureCache.has(key)) return this._textureCache.get(key);
        const tImg = CanvasRenderer.generate(pt.title || '', { w: 2048, h: 300, size: '140px', color: '#ff5500' });
        const dImg = CanvasRenderer.generate(pt.desc || '',  { w: 2048, h: 800, size: '90px', color: '#dddddd', wrap: true });
        const tex = {
            title: `src: url(${tImg}); transparent: true; shader: flat`,
            desc: `src: url(${dImg}); transparent: true; shader: flat`
        };
        this._textureCache.set(key, tex);
        return tex;
    },

    _paint(root, hovered) {
        const type = root.getAttribute('data-type') === 'audio' ? 'audio' : 'info';
        const palette = this.COLORS[type];
        const core = root.querySelector('.hs-core');
        const ring = root.querySelector('.hs-ring1');
        if (core) {
            core.setAttribute('material', 'color', hovered ? palette.hover : palette.base);
            core.setAttribute('material', 'opacity', hovered ? '1' : '0.96');
        }
        if (ring) ring.setAttribute('material', 'color', hovered ? palette.hover : palette.ring);
    },
};

// ============================================================
// TRANSITION MANAGER - blackout + loader
// ============================================================
const TransitionManager = {
    _blackout: null,
    _loader: null,

    init() {
        this._blackout = document.getElementById('blackout');
        this._loader   = document.getElementById('loader');
        Log.ok('TRANSITION', 'Ready');
    },

    async run(fn) {
        if (StateManager.transitioning) {
            Log.warn('TRANSITION', 'Already transitioning - ignored');
            return;
        }
        StateManager.lock();
        // Physically disable raycaster to prevent "ghost clicks" during transition
        InputManager.setRaycasterActive(false);
        
        this._blackout.classList.add('active');
        this._loader.style.display = 'flex';

        await this._wait(600);

        try {
            await fn();
        } catch(e) {
            Log.error('TRANSITION', `Error during transition: ${e.message}`);
        }

        await this._wait(600);
        this._blackout.classList.remove('active');
        await this._wait(400);
        this._loader.style.display = 'none';
        
        // Re-enable raycaster only after transition is fully opaque
        InputManager.setRaycasterActive(true);
        StateManager.unlock();
        Log.ok('TRANSITION', 'Complete');
    },

    _wait(ms) { return new Promise(r => setTimeout(r, ms)); },
};

// ============================================================
// PANORAMA MANAGER - ONLY swaps the sky texture
// ============================================================
const PanoramaManager = {
    validate(imgElement) {
        if (!imgElement || !imgElement.naturalWidth) return true; // Skip if not fully loaded
        const ratio = imgElement.naturalWidth / imgElement.naturalHeight;
        // True equirectangular is exactly 2:1 (e.g. 4096x2048)
        if (ratio < 1.9 || ratio > 2.1) {
            Log.warn('PANORAMA', `Validation failed: Aspect ratio is ${ratio.toFixed(2)}, expected 2.0. This is likely an invalid AI generation and WILL cause severe VR distortion.`);
            return false;
        }
        return true;
    },

    swap(sceneId) {
        const texId = '#tex-' + sceneId.replace(/\./g, '-');
        const imgEl = document.querySelector(texId);
        
        if (imgEl) {
            this.validate(imgEl);
        } else {
            Log.error('PANORAMA', `Asset not found: ${texId}`);
        }

        const sky = document.getElementById('world-sky');
        sky.setAttribute('src', texId);
        sky.setAttribute('material', 'color', '#fff');
        Log.ok('PANORAMA', `Swapped to ${texId}`);
    },
};

// ============================================================
// SCENE MANAGER - orchestrates transitions
// ============================================================
const SceneManager = {
    panoramas: [],

    init(panoramas) {
        this.panoramas = panoramas;
        Log.ok('SCENE', `${panoramas.length} scenes loaded`);
    },

    async load(sceneId) {
        if (StateManager.transitioning) {
            Log.warn('SCENE', `Blocked - already transitioning`);
            return;
        }
        if (StateManager.currentId === sceneId) {
            Log.info('SCENE', `Already on ${sceneId}`);
            return;
        }
        const scene = this.panoramas.find(p => p.id === sceneId);
        if (!scene) { Log.error('SCENE', `Not found: ${sceneId}`); return; }

        Log.info('SCENE', `Loading: ${sceneId}`);

        await TransitionManager.run(async () => {
            AudioManager.stopVoice();
            if (typeof InputManager !== 'undefined' && InputManager.clearAudioHover) InputManager.clearAudioHover();

            // 1. Close any open modals (without losing menu)
            UIManager.closeAllModals({ keepMenu: true });

            // 2. Swap panorama texture
            PanoramaManager.swap(sceneId);

            // 3. Apply scene-specific camera tuning
            const cfg = SceneConfig[sceneId] || { fov: 75 };
            const cam = document.getElementById('player-cam');
            if (cam) cam.setAttribute('camera', 'fov', cfg.fov);
            Log.info('SCENE', `FOV set to ${cfg.fov}`);

            // 4. Update metadata
            StateManager.set('currentId', sceneId);
            const pInfo = SceneDB[sceneId] || { title: scene.title, desc: 'Entorno de la zona de exclusion.' };
            const hTitle = document.getElementById('hud-title');
            const hSub = document.getElementById('hud-subtitle');
            const hDesc = document.getElementById('hud-desc');
            if (hTitle) hTitle.textContent = pInfo.title;
            if (hSub) hSub.textContent = 'UBICACI\u00d3N REGISTRADA';
            if (hDesc) hDesc.textContent = pInfo.desc;
            
            // Render Permanent VR Location Title (Cinematic glassmorphism glow)
            const sceneTex = UIManager.getSceneTitleTextures(pInfo.title);
            const tEl = document.getElementById('vr-title-txt');
            const dEl = document.getElementById('vr-subtitle-txt');
            if (tEl) tEl.setAttribute('material', sceneTex.title);
            if (dEl) dEl.setAttribute('material', sceneTex.desc);

            // 5. Reload only hotspots
            HotspotManager.clear();
            HotspotManager.load(sceneId);

            // 6. Update sidebar active state
            UIManager.updateSidebarActive(sceneId);

            // 7. Play ambient audio
            AudioManager.playAmbient(sceneId);

            // 8. Sync eye level
            UIManager.syncEyeLevel();
            if (StateManager.vrActive) UIManager.showMenu();
        });

        Log.ok('SCENE', `Ready: ${sceneId}`);
        Bus.emit('sceneReady', { sceneId });
    },

    navigate(dir) {
        if (StateManager.transitioning) return;
        const idx = this.panoramas.findIndex(p => p.id === StateManager.currentId);
        const next = (idx + dir + this.panoramas.length) % this.panoramas.length;
        Log.info('SCENE', `Navigate ${dir > 0 ? 'NEXT' : 'PREV'} -> ${this.panoramas[next].id}`);
        this.load(this.panoramas[next].id);
    },
};

// ============================================================
// UI MANAGER & CENTRALIZED STATE
// ============================================================
const UIState = {
    menuVisible: false,
    hotspotModalOpen: false,
    galleryVisible: false,
};

const UIManager = {
    _galleryCooldownUntil: 0,
    _galleryPage: 0,
    _galleryItems: [],
    _galleryPageSize: 6,
    _sceneTitleCache: new Map(),
    _menuDragActive: false,
    _menuDragUntil: 0,
    _menuDragRaf: null,
    _menuDragTimerInterval: null,

    _galleryCooldownActive() {
        return Date.now() < this._galleryCooldownUntil;
    },
    _armGalleryCooldown() {
        this._galleryCooldownUntil = Date.now() + 2000;
    },

    init() {
        this._buildStaticTextures();
        Log.ok('UI', 'Static textures built');
    },

    getSceneTitleTextures(title) {
        const key = title || '';
        if (this._sceneTitleCache.has(key)) return this._sceneTitleCache.get(key);
        const titleUrl = CanvasRenderer.generate(key, { w: 2048, h: 256, size: '140px', weight: '300', family: '"Inter", sans-serif', color: '#ffffff', align: 'left', glow: 20, glowColor: '#ff5500' });
        const descUrl = CanvasRenderer.generate('UBICACI\u00d3N REGISTRADA', { w: 2048, h: 128, size: '70px', weight: '700', family: '"JetBrains Mono", monospace', color: '#ff5500', align: 'left', glow: 5 });
        const tex = {
            title: `src: url(${titleUrl}); transparent: true; shader: flat; alphaTest: 0.5`,
            desc: `src: url(${descUrl}); transparent: true; shader: flat; alphaTest: 0.5`
        };
        this._sceneTitleCache.set(key, tex);
        return tex;
    },

    syncEyeLevel() {
        const cam = document.getElementById('player-cam');
        if (!cam || !cam.object3D) return;
        const y = cam.object3D.position.y;
        document.getElementById('ui-anchor').setAttribute('position', `0 ${y} 0`);
        document.getElementById('modal-anchor').setAttribute('position', `0 ${y} 0`);
        document.getElementById('hotspot-pool').setAttribute('position', `0 ${y} 0`);
    },

    recenterUI() {
        const cam = document.getElementById('player-cam');
        const anchor = document.getElementById('ui-anchor');
        if (!cam || !cam.object3D || !anchor) return;
        
        // Calculate the camera's global yaw rotation
        const euler = new THREE.Euler().setFromQuaternion(cam.object3D.getWorldQuaternion(new THREE.Quaternion()), 'YXZ');
        anchor.setAttribute('rotation', `0 ${(euler.y * 180) / Math.PI} 0`);
        Log.info('UI', 'Recentered UI to user gaze');
    },

    startMenuDrag() {
        if (!StateManager.vrActive || UIState.galleryVisible) return;
        this._menuDragActive = true;
        this._menuDragUntil = Date.now() + 5000;
        const timerEl = document.getElementById('menu-drag-timer-txt');
        if (timerEl) timerEl.setAttribute('visible', 'true');
        this._setMenuDragTimer(5);

        clearInterval(this._menuDragTimerInterval);
        this._menuDragTimerInterval = setInterval(() => {
            const left = Math.max(0, (this._menuDragUntil - Date.now()) / 1000);
            this._setMenuDragTimer(left);
            if (left <= 0) this.stopMenuDrag();
        }, 200);

        this._updateMenuDrag();
        Log.info('UI', 'Menu drag started');
    },

    stopMenuDrag() {
        this._menuDragActive = false;
        clearInterval(this._menuDragTimerInterval);
        this._menuDragTimerInterval = null;
        if (this._menuDragRaf) cancelAnimationFrame(this._menuDragRaf);
        this._menuDragRaf = null;
        this._setMenuDragTimer(0);
        setTimeout(() => {
            if (!this._menuDragActive) document.getElementById('menu-drag-timer-txt')?.setAttribute('visible', 'false');
        }, 800);
        Log.info('UI', 'Menu drag locked');
    },

    _updateMenuDrag() {
        if (!this._menuDragActive) return;
        if (Date.now() >= this._menuDragUntil) {
            this.stopMenuDrag();
            return;
        }
        const cam = document.getElementById('player-cam');
        const anchor = document.getElementById('ui-anchor');
        if (cam && anchor && cam.object3D) {
            const euler = new THREE.Euler().setFromQuaternion(cam.object3D.getWorldQuaternion(new THREE.Quaternion()), 'YXZ');
            const pitch = THREE.MathUtils.clamp((euler.x * 180) / Math.PI, -35, 30);
            const yaw = (euler.y * 180) / Math.PI;
            anchor.setAttribute('rotation', `${pitch} ${yaw} 0`);
        }
        this._menuDragRaf = requestAnimationFrame(() => this._updateMenuDrag());
    },

    _setMenuDragTimer(secondsLeft) {
        const el = document.getElementById('menu-drag-timer-txt');
        if (!el) return;
        const label = secondsLeft > 0 ? `MOVER ${secondsLeft.toFixed(1)}s` : 'FIJO';
        const tex = CanvasRenderer.generate(label, {
            w: 900, h: 150, size: '70px', color: '#ff8844',
            family: '"JetBrains Mono", monospace', weight: '700', glow: 8
        });
        el.setAttribute('material', `src: url(${tex}); transparent: true; shader: flat; alphaTest: 0.5`);
    },

    showMenu() {
        if (!StateManager.vrActive) {
            this.hideMenu();
            return;
        }
        // Enforce centralized UI rules: don't show menu if gallery is open
        if (UIState.galleryVisible) return;
        
        this.recenterUI();
        document.getElementById('vr-menu').setAttribute('visible', 'true');
        document.querySelectorAll('#vr-menu .ui-button, #vr-menu .drag-dot').forEach(el => el.classList.add('interactable'));
        document.getElementById('menu-drag-timer-txt')?.setAttribute('visible', 'false');
        UIState.menuVisible = true;
        Log.info('UI', 'Menu shown');
        InputManager.refreshCursor();
    },

    hideMenu() {
        this.stopMenuDrag();
        document.getElementById('vr-menu').setAttribute('visible', 'false');
        document.querySelectorAll('#vr-menu .ui-button, #vr-menu .drag-dot').forEach(el => el.classList.remove('interactable'));
        UIState.menuVisible = false;
        Log.info('UI', 'Menu hidden');
    },

    showGallery() {
        if (this._galleryCooldownActive()) return;
        this._armGalleryCooldown();
        Log.info('UI', 'Opening gallery');
        try {
            UIState.galleryVisible = true;
            StateManager.set('modalOpen', true);
            HotspotManager.lock();
            HotspotManager.closeTooltip();
            this.hideMenu();
            this.recenterUI();
            
            const gal = document.getElementById('vr-gallery');
            if (!gal) { Log.error('UI', 'vr-gallery element not found'); return; }
            gal.setAttribute('visible', 'true');
            // Re-enable interactable on gallery elements so raycaster can hit them
            gal.querySelectorAll('.gal-thumb, .ui-button, .raycast-blocker').forEach(el => {
                el.classList.add('interactable');
            });
            InputManager.refreshCursor();
            Log.ok('UI', 'Gallery opened successfully');
        } catch(err) {
            Log.error('UI', 'Gallery open failed: ' + err.message);
        }
    },

    closeGallery(opts = {}) {
        if (!opts.force && this._galleryCooldownActive()) return;
        if (!opts.force) this._armGalleryCooldown();
        Log.info('UI', 'Closing gallery');
        try {
            const gal = document.getElementById('vr-gallery');
            if (gal) {
                gal.setAttribute('visible', 'false');
                // Remove interactable from ALL gallery children so they stop blocking raycaster
                gal.querySelectorAll('.gal-thumb, .ui-button, .raycast-blocker').forEach(el => {
                    el.classList.remove('interactable');
                });
            }
            UIState.galleryVisible = false;
            StateManager.set('modalOpen', false);
            HotspotManager.unlock();
            this.showMenu();
            InputManager.refreshCursor();
            Log.ok('UI', 'Gallery closed successfully');
        } catch(err) {
            Log.error('UI', 'Gallery close failed: ' + err.message);
        }
    },

    // Note: showInfoPanel & closeInfoPanel were deprecated in V14.
    // Hotspot tooltips are now handled locally by HotspotManager.

    closeAllModals(opts = {}) {
        if (!opts.keepMenu) this.hideMenu();
        const gal = document.getElementById('vr-gallery');
        if (gal) {
            gal.setAttribute('visible', 'false');
            gal.querySelectorAll('.gal-thumb, .ui-button, .raycast-blocker').forEach(el => {
                el.classList.remove('interactable');
            });
        }
        UIState.galleryVisible = false;
        StateManager.set('modalOpen', false);
        HotspotManager.closeTooltip();
        InputManager.refreshCursor();
        Log.info('UI', 'All modals closed');
    },

    toggleSidebar() {
        if (this._galleryCooldownActive()) return;
        this._armGalleryCooldown();
        StateManager.set('sidebarOpen', !StateManager.sidebarOpen);
        document.getElementById('sidebar').classList.toggle('open', StateManager.sidebarOpen);
        Log.info('UI', `Sidebar: ${StateManager.sidebarOpen ? 'open' : 'closed'}`);
    },

    updateSidebarActive(sceneId) {
        document.querySelectorAll('.sidebar-item').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.sceneId === sceneId);
        });
    },

    buildSidebar(panoramas) {
        const list = document.getElementById('sidebar-list');
        list.innerHTML = '';
        panoramas.forEach(p => {
            const btn = document.createElement('button');
            btn.className = 'sidebar-item';
            btn.textContent = p.title;
            btn.dataset.sceneId = p.id;
            btn.onclick = () => {
                AudioManager.click();
                SceneManager.load(p.id);
                StateManager.set('sidebarOpen', false);
                document.getElementById('sidebar').classList.remove('open');
            };
            list.appendChild(btn);
        });
        Log.ok('UI', `Sidebar built: ${panoramas.length} items`);
    },

    build3DGallery(panoramas) {
        this._galleryItems = panoramas.slice();
        this._galleryPage = 0;
        this._renderGalleryPage();
    },

    _renderGalleryPage() {
        const grid = document.getElementById('gallery-grid');
        if (!grid) { Log.error('UI', 'gallery-grid not found'); return; }
        // Remove old children safely
        while (grid.firstChild) grid.removeChild(grid.firstChild);
        
        const panoramas = this._galleryItems;
        const totalPages = Math.max(1, Math.ceil(panoramas.length / this._galleryPageSize));
        this._galleryPage = Math.max(0, Math.min(this._galleryPage, totalPages - 1));
        const pageItems = panoramas.slice(
            this._galleryPage * this._galleryPageSize,
            (this._galleryPage + 1) * this._galleryPageSize
        );

        const cols = 3, cellW = 0.48, cellH = 0.26, gapX = 0.05, gapY = 0.045;
        const totalRows = 2;
        const stepY = cellH + gapY;
        const startY = ((totalRows - 1) * stepY) / 2;
        
        pageItems.forEach((p, i) => {
            const col = i % cols, row = Math.floor(i / cols);
            const x = (col - 1) * (cellW + gapX);
            const y = startY - (row * stepY);
            
            const box = document.createElement('a-entity');
            box.setAttribute('class', 'interactable gal-thumb');
            box.setAttribute('data-scene-id', p.id);
            box.setAttribute('position', `${x} ${y} 0`);
            box.setAttribute('geometry', `primitive: plane; width: ${cellW}; height: ${cellH}`);
            // Fix extreme fisheye by center-cropping the equirectangular texture (zoom to equator)
            box.setAttribute('material', `src: #tex-${p.id.replace(/\./g, '-')}; shader: flat; repeat: 0.42 0.42; offset: 0.29 0.29`);
            grid.appendChild(box);
        });

        const prevBtn = document.getElementById('gal-prev-page');
        const nextBtn = document.getElementById('gal-next-page');
        if (prevBtn) {
            prevBtn.setAttribute('visible', totalPages > 1 ? 'true' : 'false');
            prevBtn.classList.toggle('interactable', UIState.galleryVisible && totalPages > 1);
        }
        if (nextBtn) {
            nextBtn.setAttribute('visible', totalPages > 1 ? 'true' : 'false');
            nextBtn.classList.toggle('interactable', UIState.galleryVisible && totalPages > 1);
        }
        const pageTxt = document.getElementById('gal-page-txt');
        if (pageTxt) {
            const label = `${this._galleryPage + 1}/${totalPages}`;
            pageTxt.setAttribute('material', `src: url(${CanvasRenderer.generate(label, { w: 600, h: 160, size: '76px', color: '#dddddd', family: '"JetBrains Mono", monospace', weight: '700' })}); transparent: true; shader: flat; alphaTest: 0.5`);
        }

        const closeBtn = document.getElementById('gal-close-btn');
        if (closeBtn) {
            closeBtn.setAttribute('position', '0 -0.76 0.01');
        }

        const galBg = grid.parentElement ? grid.parentElement.querySelector('.raycast-blocker') : null;
        if (galBg) galBg.setAttribute('geometry', 'primitive: plane; width: 2.4; height: 1.8');
        
        Log.ok('UI', `3D Gallery page ${this._galleryPage + 1}/${totalPages}`);
        
        // Must refresh raycaster after dynamic element creation
        setTimeout(() => InputManager.refreshCursor(), 300);
    },

    changeGalleryPage(dir) {
        const totalPages = Math.max(1, Math.ceil(this._galleryItems.length / this._galleryPageSize));
        this._galleryPage = (this._galleryPage + dir + totalPages) % totalPages;
        AudioManager.click();
        this._renderGalleryPage();
    },

    _buildStaticTextures() {
        const t = (txt, w, h, s, c, glow) => CanvasRenderer.generate(txt, { w, h, size: s, color: c || '#ffffff', family: '"Inter", sans-serif', weight: '600', glow: glow || 0 });
        const set = (id, url) => { const el = document.getElementById(id); if(el) el.setAttribute('material', `src: url(${url}); transparent: true; shader: flat; alphaTest: 0.5`); };
        
        // Generate the AUDIO floating tag texture once and apply it to all hs-audio-tag elements
        const audioTagTex = t('ESCUCHAR AUDIO', 800, 200, '80px', '#1f8cff', 12);
        document.querySelectorAll('.hs-audio-tag').forEach(el => el.setAttribute('material', `src: url(${audioTagTex}); transparent: true; shader: flat; alphaTest: 0.5`));

        const menuBg = CanvasRenderer.roundedPanel({
            w: 1400, h: 220, radius: 60, border: 2,
            top: 'rgba(18,20,24,0.92)', bottom: 'rgba(6,7,10,0.94)',
            stroke: 'rgba(255,255,255,0.12)'
        });
        const galleryBg = CanvasRenderer.roundedPanel({
            w: 1600, h: 1200, radius: 56, border: 2,
            top: 'rgba(18,20,26,0.94)', bottom: 'rgba(4,4,6,0.95)',
            stroke: 'rgba(255,255,255,0.14)'
        });
        const hotspotBg = CanvasRenderer.roundedPanel({
            w: 1400, h: 900, radius: 64, border: 2,
            top: 'rgba(20,23,30,0.95)', bottom: 'rgba(5,6,8,0.95)',
            stroke: 'rgba(255,255,255,0.15)'
        });
        set('vr-menu-bg', menuBg);
        set('vr-gallery-bg', galleryBg);
        set('vr-hotspot-bg', hotspotBg);
        
        // Nav bar buttons (Premium styling)
        set('menu-prev-txt',  t('< ANT', 600, 200, '90px', '#dddddd', 5));
        set('menu-gal-txt',   t('GALER\u00cdA', 1000, 200, '100px', '#ff8844', 10));
        set('menu-next-txt',  t('SIG >', 600, 200, '90px', '#dddddd', 5));
        SubtitleManager._updateToggleLabel();
        
        // Gallery modal
        set('gal-title-txt',  t('BASE DE DATOS VISUAL', 2048, 250, '130px', '#ff5500', 15));
        set('gal-prev-page-txt', t('<', 500, 200, '110px', '#dddddd', 8));
        set('gal-next-page-txt', t('>', 500, 200, '110px', '#dddddd', 8));
        set('gal-page-txt', t('1/1', 600, 160, '76px', '#dddddd', 0));
        set('gal-close-txt',  t('X CERRAR', 800, 200, '90px', '#ff4422', 10));
        
        // Hotspot Modal
        set('modal-hs-close-txt', t('X CERRAR', 800, 200, '90px', '#ff4422', 10));
        set('modal-hs-title', t('INFO', 800, 200, '90px', '#ff5500', 10));

        // Tooltip Close Button
        const closeTex = t('X CERRAR', 800, 150, '80px', '#ff4422', 10);
        document.querySelectorAll('.hs-close-txt').forEach(el => el.setAttribute('material', `src: url(${closeTex}); transparent: true; shader: flat; alphaTest: 0.5`));
    },
};

// ============================================================
// INPUT MANAGER - V12 Central Raycaster Engine
// ============================================================
const InputManager = {
    _fuseTimer: null,
    _fuseTarget: null,
    _active: true,
    _audioHoverRoot: null,
    _audioClearTimer: null,

    init() {
        this._bindHUDButtons();
        
        const cam = document.getElementById('player-cam');
        if (!cam) return;

        // Listen to raw raycaster intersections
        cam.addEventListener('raycaster-intersection', (e) => {
            if (!this._active || StateManager.transitioning) return;
            const target = e.detail.els[0];
            if (!target) return;
            if (this._isRaycastBlocker(target)) {
                this._clearAudioHover();
                this._startFuse(target);
                return;
            }
            this._handleAudioHover(target);
            this._startFuse(target);
        });

        cam.addEventListener('raycaster-intersection-cleared', (e) => {
            const target = e.detail.clearedEls[0];
            if (this._fuseTarget === target) {
                this._cancelFuse();
            }
            this._clearAudioHover(target);
        });
        
        // Handle desktop explicit clicks
        window.addEventListener('click', (e) => {
             if (e.target && e.target.closest && e.target.closest('button, .overlay, #hud, #sidebar')) {
                 return;
             }
             if (this._fuseTarget && this._active && !StateManager.transitioning) {
                 e.preventDefault();
                 e.stopPropagation();
                 this._triggerClick(this._fuseTarget);
                 this._cancelFuse();
             }
        });
        
        this._bindRaycastBlockers();
        this._bindVRModeEvents();
        Log.ok('INPUT', 'Central Raycaster Engine V12 Initialized');
    },

    setRaycasterActive(active) {
        this._active = active;
        const cam = document.getElementById('player-cam');
        if (cam) cam.setAttribute('raycaster', 'enabled', active);
        if (!active) this._cancelFuse();
        Log.info('INPUT', `Raycaster ${active ? 'ENABLED' : 'DISABLED'}`);
    },

    _startFuse(target) {
        if (this._fuseTarget === target) return;
        this._fuseTarget = target;

        if (!StateManager.vrActive) {
            return;
        }
        
        // Visual feedback
        const dot = document.getElementById('reticle-dot');
        const ring = document.getElementById('reticle-ring');
        
        if (dot) {
            dot.setAttribute('material', 'color', '#00ff00');
            dot.setAttribute('scale', '1.5 1.5 1.5');
        }
        if (ring) {
            const fuseMs = this._getFuseDuration(target);
            ring.setAttribute('animation__fuse', `property: scale; from: 1 1 1; to: 0.2 0.2 0.2; dur: ${fuseMs}; easing: linear`);
        }
        
        const fuseMs = this._getFuseDuration(target);
        this._fuseTimer = setTimeout(() => {
            if (!StateManager.transitioning && this._active) {
                this._triggerClick(target);
            }
            this._cancelFuse();
        }, fuseMs);
    },

    _getFuseDuration(target) {
        return target && target.closest && target.closest('#menu-drag-handle') ? 3000 : 1500;
    },

    _cancelFuse() {
        if (this._fuseTimer) clearTimeout(this._fuseTimer);
        this._fuseTimer = null;
        this._fuseTarget = null;
        
        // Reset visuals
        const dot = document.getElementById('reticle-dot');
        const ring = document.getElementById('reticle-ring');
        
        if (dot) {
            dot.setAttribute('material', 'color', '#ff5500');
            dot.setAttribute('scale', '1 1 1');
        }
        if (ring) {
            ring.removeAttribute('animation__fuse');
            ring.setAttribute('scale', '1 1 1');
        }
    },

    _triggerClick(target) {
        if (!target) return;
        Log.info('INPUT', `_triggerClick on: ${target.id || target.className}`);

        if (this._isRaycastBlocker(target)) {
            Log.info('INPUT', 'Raycast blocker consumed click');
            return;
        }
        
        const id = target.id;

        const dragHandle = target.closest ? target.closest('#menu-drag-handle') : null;
        if (dragHandle) {
            UIManager.startMenuDrag();
            Log.info('INPUT', 'Menu drag handle activated');
            return;
        }

        // Tooltip close buttons
        const closeBtn = target.closest ? target.closest('#modal-hs-close') : null;
        if (closeBtn) {
            AudioManager.click();
            HotspotManager.closeTooltip();
            Log.info('INPUT', 'Tooltip close triggered');
            return;
        }

        // Hotspot sphere/hitbox clicks -> open tooltip
        const hsRoot = target.closest ? target.closest('.hs-container') : null;
        if (hsRoot && hsRoot.classList.contains('active-hs')) {
            const type = hsRoot.getAttribute('data-type');
            if (type === 'audio') {
                const trackId = hsRoot.getAttribute('data-target');
                if (trackId) AudioManager.playVoice(trackId);
            } else if (type === 'scene') {
                AudioManager.click();
                SceneManager.load(hsRoot.getAttribute('data-target'));
            } else {
                AudioManager.click();
                HotspotManager.openTooltip(hsRoot);
            }
            Log.info('INPUT', `Hotspot activated: ${hsRoot.id}`);
            return;
        } 
        
        // UI Navigation & Modals
        if (id === 'menu-prev') { AudioManager.click(); SceneManager.navigate(-1); }
        else if (id === 'menu-next') { AudioManager.click(); SceneManager.navigate(1); }
        else if (id === 'menu-gallery') { AudioManager.click(); UIManager.showGallery(); }
        else if (id === 'menu-subtitles') { AudioManager.click(); SubtitleManager.toggle(); }
        else if (id === 'gal-close-btn') { AudioManager.click(); UIManager.closeGallery(); }
        else if (id === 'gal-prev-page') { UIManager.changeGalleryPage(-1); }
        else if (id === 'gal-next-page') { UIManager.changeGalleryPage(1); }
        else if (target.classList && target.classList.contains('gal-thumb')) {
            const gal = document.getElementById('vr-gallery');
            if (!gal || gal.getAttribute('visible') === 'false') return;
            const sceneId = target.getAttribute('data-scene-id');
            if (sceneId && !StateManager.transitioning) {
                AudioManager.click();
                UIManager.closeGallery({ force: true });
                SceneManager.load(sceneId);
            }
        }
    },

    _bindHUDButtons() {
        const b = (id, fn) => { const el = document.getElementById(id); if(el) el.onclick = fn; };
        b('btn-prev',    () => { AudioManager.click(); SceneManager.navigate(-1); });
        b('btn-next',    () => { AudioManager.click(); SceneManager.navigate(1); });
        b('btn-gallery', () => { AudioManager.click(); UIManager.toggleSidebar(); });
        b('btn-vr',      () => { AudioManager.click(); App.enterVR(); });
        Log.ok('INPUT', 'HUD buttons bound');
    },

    _bindRaycastBlockers() {
        document.querySelectorAll('.raycast-blocker').forEach(el => {
            el.addEventListener('click', (e) => { e.stopPropagation(); });
        });
    },

    _isRaycastBlocker(target) {
        if (!target || !target.closest) return false;
        const blocker = target.closest('.raycast-blocker');
        if (!blocker) return false;
        const owner = blocker.closest('[visible]');
        return !owner || owner.getAttribute('visible') !== 'false';
    },

    _bindVRModeEvents() {
        const scene = document.querySelector('a-scene');
        scene.addEventListener('enter-vr', () => {
            StateManager.set('vrActive', true);
            const vrTitle = document.getElementById('vr-location-title');
            if (vrTitle) vrTitle.setAttribute('visible', 'true');
            UIManager.showMenu();
            Log.ok('INPUT', 'VR Mode Active');
        });
        scene.addEventListener('exit-vr', () => {
            StateManager.set('vrActive', false);
            UIManager.hideMenu();
            const vrTitle = document.getElementById('vr-location-title');
            if (vrTitle) vrTitle.setAttribute('visible', 'false');
            Log.ok('INPUT', 'Desktop Mode Active');
        });
    },

    refreshCursor() {
        setTimeout(() => {
            const cam = document.getElementById('player-cam');
            if (cam && cam.components && cam.components.raycaster) {
                cam.components.raycaster.refreshObjects();
            }
        }, 150);
    },

    _handleAudioHover(target) {
        if (!target || UIState.hotspotModalOpen) return;
        const hsRoot = target.closest ? target.closest('.hs-container') : null;
        if (!hsRoot || !hsRoot.classList.contains('active-hs')) return;
        if (hsRoot.getAttribute('data-type') !== 'audio') return;
        if (this._audioClearTimer) {
            clearTimeout(this._audioClearTimer);
            this._audioClearTimer = null;
        }
        if (this._audioHoverRoot === hsRoot) return;

        if (this._audioHoverRoot) {
            HotspotManager._paint(this._audioHoverRoot, false);
        }

        this._audioHoverRoot = hsRoot;
        HotspotManager._paint(hsRoot, true);
        const trackId = hsRoot.getAttribute('data-target');
        if (trackId) AudioManager.playVoice(trackId);
    },

    _clearAudioHover(target) {
        if (!this._audioHoverRoot) return;
        const clearedRoot = target && target.closest ? target.closest('.hs-container') : null;
        if (clearedRoot && clearedRoot !== this._audioHoverRoot) return;
        if (this._audioClearTimer) clearTimeout(this._audioClearTimer);
        this._audioClearTimer = setTimeout(() => {
            if (!this._audioHoverRoot) return;
            HotspotManager._paint(this._audioHoverRoot, false);
            this._audioHoverRoot = null;
            this._audioClearTimer = null;
            if (!UIState.hotspotModalOpen) AudioManager.stopVoice();
        }, 220);
    },

    clearAudioHover() {
        if (this._audioClearTimer) {
            clearTimeout(this._audioClearTimer);
            this._audioClearTimer = null;
        }
        if (this._audioHoverRoot) {
            HotspotManager._paint(this._audioHoverRoot, false);
        }
        this._audioHoverRoot = null;
    }
};

// ============================================================
// APP - bootstrap
// ============================================================
const App = {
    async init() {
        Log.init();
        if (DEBUG) document.body.classList.add('debug');
        Log.ok('APP', 'Engine V9.0 starting...');
        this._bindMobileViewportFixes();

        // Wait for A-Frame scene to be ready
        const scene = document.querySelector('a-scene');
        if (scene.hasLoaded) {
            await this._start();
        } else {
            scene.addEventListener('loaded', () => this._start());
        }
    },

    async _start() {
        Log.ok('APP', 'A-Frame scene ready');

        // Load panorama manifest
        let panoramas;
        try {
            const res = await fetch('panoramas.json');
            panoramas = await res.json();
            StateManager.panoramas = panoramas;
        } catch(e) {
            Log.error('APP', 'Failed to load panoramas.json');
            return;
        }

        // Initialize subsystems
        TransitionManager.init();
        SceneManager.init(panoramas);
        UIManager.init();
        UIManager.buildSidebar(panoramas);
        UIManager.build3DGallery(panoramas);
        InputManager.init();
        AudioManager.init();
        HotspotManager.init();

        // Wait for assets
        const assets = document.getElementById('engine-assets');
        const onReady = () => this._enableLaunch();
        assets.hasLoaded ? onReady() : assets.addEventListener('loaded', onReady);
    },

    _enableLaunch() {
        Log.ok('APP', 'Assets ready - enabling launch');
        const btn = document.getElementById('btn-start');
        btn.textContent = 'INICIAR SIMULACI\u00d3N';
        btn.disabled = false;
        btn.addEventListener('click', () => this._launch());
    },

    _launch() {
        Log.ok('APP', 'Launching experience');
        AudioManager.click();
        document.getElementById('launcher').classList.add('hidden');
        document.getElementById('hud').classList.add('active');
        UIManager.syncEyeLevel();
        
        // Cursor is now a pure visual element, raycaster is on player-cam
        InputManager.refreshCursor();
        
        UIManager.hideMenu();
        SceneManager.load(StateManager.panoramas[0].id);
    },

    enterVR() {
        const scene = document.querySelector('a-scene');
        if (!scene || !scene.enterVR) return;
        if (!window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
            alert('Para VR/Cardboard usa HTTPS. GitHub Pages sirve; una IP local por HTTP puede fallar.');
        }
        const result = scene.enterVR();
        if (result && result.catch) {
            result.catch(() => {
                alert('Este navegador no pudo abrir VR/Cardboard. Proba Chrome en Android o GitHub Pages por HTTPS.');
            });
        }
    },

    _bindMobileViewportFixes() {
        const resize = () => {
            const scene = document.querySelector('a-scene');
            if (scene && scene.resize) scene.resize();
            if (typeof InputManager !== 'undefined' && InputManager.refreshCursor) InputManager.refreshCursor();
        };
        window.addEventListener('orientationchange', () => setTimeout(resize, 350));
        window.addEventListener('resize', () => setTimeout(resize, 100));
    },
};

// ============================================================
// BOOTSTRAP
// ============================================================
window.addEventListener('DOMContentLoaded', () => App.init());
