// The mono output from WavRecorder
function monoArrayBufferToBase64(arrayBuffer) {
  let binary = "";
  let bytes = new Uint8Array(arrayBuffer);
  const chunkSize = 0x8000; // 32KB chunk size
  for (let i = 0; i < bytes.length; i += chunkSize) {
    let chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

function base64ToInt16Array(base64) {
  const raw = atob(base64);
  const bytes = Uint8Array.from(raw, (m) => m.codePointAt(0));
  return new Int16Array(bytes.buffer);
}

document.addEventListener("DOMContentLoaded", () => {
  const parrot = document.getElementById("parrot");
  const notAuthenticated = document.getElementById("not-authenticated");
  const authenticationRequired = document.getElementById(
    "authentication-required"
  );
  const recordingStatus = document.getElementById("recording-status");
  const characterChooser = document.getElementById("character-chooser");
  const parrotTranscript = document.getElementById("parrot-transcript");
  let isRecording = false;

  notAuthenticated.style.display = "none";
  // Hackers might try to set this...
  if (!document.cookie.includes("jwtPayload")) {
    notAuthenticated.style.display = "block";
    authenticationRequired.display = "none";
  } else {
    try {
      const url = new URL(window.location.href);
      const protocol = url.protocol === "http:" ? "ws" : "wss";
      // ...But hackers will not get past this as it is behind /auth and jwt middleware will catch it
      const webSocketURL = `${protocol}://${url.hostname}${
        url.port ? ":" + url.port : ""
      }/auth/ws`;
      console.log("Attempting to connect", webSocketURL);
      const ws = new WebSocket(webSocketURL);
      // Intialize
      ws.onopen = () => {
        refreshParrotSetup();
      };
      authenticationRequired.style.display = "block";
      // This is a global JS include
      const wavRecorder = new WavRecorder({ sampleRate: 24000 });
      const wavStreamPlayer = new WavStreamPlayer({ sampleRate: 24000 });
      ws.onmessage = (evt) => {
        const data = JSON.parse(evt.data);
        switch (data.type) {
          case "response.audio.delta":
            const bytes = base64ToInt16Array(data.delta);
            wavStreamPlayer.add16BitPCM(bytes, data.item_id);
            break;
          case "response.audio_transcript.delta":
            parrotTranscript.innerText += data.delta;
            break;
          default:
            console.log(data.type, data);
            break;
        }
      };
      function refreshParrotSetup(evt) {
        const prompt = characterChooser.value;
        const sessionUpdateEvent = {
          type: "session.update",
          session: {
            voice: "verse",
            instructions: `Your task is repeat back what the user said but in your own tone. You are ${prompt}. Only restate what the user said and nothing else.`,
          },
        };
        ws.send(JSON.stringify(sessionUpdateEvent));
      }
      characterChooser.addEventListener("change", (evt) => {
        parrotTranscript.style.display = "none";
      });
      parrot.addEventListener("click", async () => {
        await wavStreamPlayer.connect();
        isRecording = !isRecording;
        if (isRecording) {
          parrotTranscript.innerText = "";
          refreshParrotSetup();
          recordingStatus.style.display = "block";
          // https://platform.openai.com/docs/api-reference/realtime
          await wavRecorder.begin();
          // This outputs chunks
          await wavRecorder.record((data) => {
            const base64AudioData = monoArrayBufferToBase64(data.mono);
            console.log("Appending", base64AudioData.length, "base64");
            const appendEvent = {
              type: "input_audio_buffer.append",
              audio: base64AudioData,
            };
            ws.send(JSON.stringify(appendEvent));
          });
        } else {
          parrotTranscript.style.display = "block";
          recordingStatus.style.display = "none";
          await wavRecorder.end();
          const commitEvent = {
            type: "input_audio_buffer.commit",
          };
          ws.send(JSON.stringify(commitEvent));
          // Request a response
          ws.send(JSON.stringify({ type: "response.create" }));
        }
      });
    } catch (err) {
      // Hide the parrot
      authenticationRequired.style.display = "none";
      console.error(err);
    }
  }
});
