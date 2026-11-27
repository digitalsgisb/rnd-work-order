import {useEffect,useState} from 'react';
import {BellRing,BellOff} from 'lucide-react';

async function api(path,body) {
  const response = await fetch('/api/push'+path,{
    method:body===undefined?'GET':'POST',
    credentials:'same-origin',
    cache:'no-store',
    headers:{
      'Content-Type':'application/json',
      'X-RND-Request':'1'
    },
    ...(body===undefined?{}:{
      body:JSON.stringify(body)
    })
  });

  const data=await response.json();

  if(!response.ok) {
    throw Error(data.error||'Request failed');
  }

  return data;
}

function decodeKey(value) {
  const base64=value
    .replace(/-/g,'+')
    .replace(/_/g,'/');

  const padded=base64.padEnd(
    Math.ceil(base64.length/4)*4,'='
  );

  return Uint8Array.from(
    atob(padded),c=>c.charCodeAt(0)
  );
}



export async function reconnectPhoneNotifications() {
  if (
    !('serviceWorker' in navigator) ||
    !('Notification' in window)
  ) {
    return false;
  }

  if (Notification.permission !== 'granted') {
    return false;
  }

  let registration;
  let subscription;

  // Allow time for the service worker and
  // existing browser subscription to become ready.

  for (let attempt = 0; attempt < 12; attempt++) {

    registration =
      await navigator.serviceWorker.getRegistration('/');

    if (registration?.active &&
        registration.pushManager) {

      subscription =
        await registration.pushManager.getSubscription();

      if (subscription) break;
    }

    await new Promise(
      resolve => setTimeout(resolve, 500)
    );
  }

  if (!registration?.active) {
    throw Error('Service worker is not ready.');
  }

  if (!subscription) {
    throw Error(
      'No existing phone subscription found. Enable notifications once to register this device.'
    );
  }

  const result = await api(
    '/reconnect',
    subscription.toJSON()
  );

  if (!result.enabled) {
    throw Error(
      'Device subscription does not match the saved registration for this account.'
    );
  }

  return true;
}

export default function PushSettings()
 {
  const [enabled,setEnabled]=useState(false);
  const [busy,setBusy]=useState(false);
  const [checking,setChecking]=useState(true);
  const [error,setError]=useState('');

  const supported=
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window;


  useEffect(()=>{
    let active = true;

    async function check() {
      try {
        if (!supported) return;

        if (Notification.permission !== 'granted') {
          if(active) setEnabled(false);
          return;
        }

        const connected =
          await reconnectPhoneNotifications();

        if(active) {
          setEnabled(connected);
          setError('');
        }

      } catch(err) {
        if(active) {
          setEnabled(false);
          setError(err.message);
        }
      } finally {
        if(active) setChecking(false);
      }
    }

    check();

    return ()=>{active=false;};

  },[supported]);


  async function enable() {
    if(busy) return;

    setBusy(true);
    setError('');

    try {
      const permission=
        await Notification.requestPermission();

      if(permission!=='granted') {
        throw Error(
          'Notification permission was not granted. Check your phone settings.'
        );
      }

      const {publicKey}=await api('/public-key');

      const registration=
        await navigator.serviceWorker.getRegistration('/');

      if(!registration?.active) {
        throw Error(
          'Service worker is not ready. Refresh the app and try again.'
        );
      }

      let subscription=
        await registration.pushManager.getSubscription();

      if(!subscription) {
        subscription=
          await registration.pushManager.subscribe({
            userVisibleOnly:true,
            applicationServerKey:decodeKey(publicKey)
          });
      }

      await api(
        '/subscribe',
        subscription.toJSON()
      );

      setEnabled(true);

    } catch(err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    if(busy) return;

    setBusy(true);
    setError('');

    try {
      const registration=
        await navigator.serviceWorker.getRegistration('/');

      const subscription=
        await registration?.pushManager.getSubscription();

      if(subscription) {
        await api('/unsubscribe',{
          endpoint:subscription.endpoint
        });

        await subscription.unsubscribe();
      }

      setEnabled(false);

    } catch(err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="push-settings">

      <div className="push-settings-heading">

        <div className="push-settings-icon">
          {enabled
            ?<BellRing size={24}/>
            :<BellOff size={24}/>
          }
        </div>

        <div>
          <strong>Device notifications</strong>
          <p>
            Receive work order alerts on this device.
          </p>
          <small>
            {!supported
              ?'Not supported in this browser'
              :checking
              ?'Checking device...'
              :enabled
              ?'Enabled on this device'
              :'Not enabled on this device'}
          </small>
        </div>

      </div>

      {!supported&&
        <p className="muted">
          On iPhone, install the website using
          Add to Home Screen and open the installed app.
        </p>
      }

      {supported&&
        <button
          type="button"
          className={'btn '+(enabled?'':'primary')}
          disabled={busy||checking}
          onClick={enabled?disable:enable}
        >
          {busy?'Please wait...':
            enabled?'Disable phone notifications':
            'Enable phone notifications'}
        </button>
      }

      {error&&
        <p role="alert" className="notification-error">
          {error}
        </p>
      }

    </section>
  );
}
