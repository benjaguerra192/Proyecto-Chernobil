# Chernobyl VR

Recorrido web en 360 grados sobre Chernobyl, hecho con A-Frame.

El proyecto funciona como sitio estatico: no necesita backend ni base de datos.

## Como abrirlo

| Opcion | Uso |
| --- | --- |
| Navegador | Abrir `index.html` directamente. |
| Servidor local | Recomendado si el navegador bloquea audios o texturas. |
| GitHub Pages | Compatible. Subir el proyecto y activar Pages desde la rama principal. |

## Controles

| Accion | Desktop | VR / movil |
| --- | --- | --- |
| Mirar alrededor | Mouse | Mover cabeza o telefono |
| Abrir hotspot | Click | Mantener mirada sobre el punto |
| Cambiar escena | Botones o hotspot de escena | Mirada sobre hotspot |
| Reproducir audio | Hotspot azul | Mirada sobre hotspot azul |
| Mover menu VR | Mirar el control superior 3 segundos | El menu sigue la mirada 5 segundos |

## Hotspots

| Color | Funcion |
| --- | --- |
| Naranja | Informacion o cambio de escena |
| Azul | Audio solamente |

Los audios no abren paneles. Los paneles informativos aparecen cerca de la altura del hotspot que los activa.

## Escenas

| Imagen | Lugar |
| --- | --- |
| `menu_principal.png` | Sarcofago |
| `control_room_1.png` | Sala de control |
| `control_room_2.png` | Paneles de seguridad |
| `control_room_3.png` | Sala de control alterada |
| `control_room_3_quemado.png` | Sala de control dañada |
| `reactor_control_rods_zone.png` | Zona de barras de control |
| `reactor_explosion_moment.png` | Momento de la explosion |
| `reactor_roof.png` | Techo del reactor |
| `elephants_foot.png` | Pie de elefante |
| `pripyat_ferris_wheel.png` | Parque de Pripyat |

## Archivos principales

| Archivo | Para que sirve |
| --- | --- |
| `index.html` | Estructura de la experiencia y carga de assets |
| `engine.js` | Logica de escenas, hotspots, audio y UI |
| `panoramas.json` | Lista de panoramas disponibles |
| `Imagenes/` | Panoramas 360 |
| `Audios/` | Ambiente, efectos y voces |
| `AUDIOS_REFINADOS.md` | Audios usados y guiones corregidos |

## Agregar una escena

1. Guardar la imagen 360 dentro de `Imagenes/`.
2. Agregarla en `panoramas.json`.
3. Cargar el asset en `index.html`.
4. Crear sus hotspots en `engine.js`.

## Agregar un audio

1. Guardar el archivo `.mp3` dentro de `Audios/`.
2. Crear un hotspot `type: 'audio'` en `engine.js`.
3. Usar en `target` el nombre del archivo sin `.mp3`.

Ejemplo:

```js
{ type: 'audio', target: 'voz_control_1', pos: '0 -0.35 -3', title: 'CONSOLA AZ-5' }
```

Ese hotspot busca este archivo:

```txt
Audios/voz_control_1.mp3
```

## Notas

- Pensado para uso educativo.
- Compatible con GitHub Pages.
- Conviene mantener nombres de archivos simples, sin espacios.
- Las imagenes panoramicas deben ser equirectangulares para verse bien en 360.
