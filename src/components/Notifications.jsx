import PushSettings from './PushSettings.jsx';
import {useEffect,useState} from 'react';
import {
  Bell, CheckCheck, ClipboardCheck,
  UserCheck, RotateCcw, CheckCircle2,
  Clock, AlertCircle, ChevronRight
} from 'lucide-react';

import {
  getNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead
} from '../api.js';

const icons = {
  submitted: ClipboardCheck,
  reapproval: ClipboardCheck,
  approved: CheckCircle2,
  assigned: UserCheck,
  rework: RotateCcw,
  reopened: RotateCcw,
  completed: CheckCircle2,
  verified: CheckCircle2,
  closed: CheckCircle2,
  verification: ClipboardCheck,
  due_soon: Clock,
  overdue: AlertCircle,
  unable: AlertCircle,
  rejected: AlertCircle,
  returned: RotateCcw
};

export function useNotifications(userId,page) {
  const [revision,setRevision] = useState(0);

  const [data,setData] = useState({
    owner:null,
    items:[],
    count:0,
    loading:true,
    error:''
  });

  useEffect(()=>{
    if(!userId) return;

    let active = true;
    let running = false;

    async function load() {
      if(!active || running) return;

      running = true;

      try {
        const [items,unread] = await Promise.all([
          getNotifications(),
          getUnreadCount()
        ]);

        if(active) {
          setData({
            owner:userId,
            items,
            count:Number(unread.count)||0,
            loading:false,
            error:''
          });
        }

      } catch(err) {
        if(active) {
          setData(old=>({
            owner:userId,
            items:old.owner===userId?old.items:[],
            count:old.owner===userId?old.count:0,
            loading:false,
            error:err.message
          }));
        }
      } finally {
        running = false;
      }
    }

    load();

    const timer = setInterval(load,15000);

    window.addEventListener('focus',load);

    return ()=>{
      active = false;
      clearInterval(timer);
      window.removeEventListener('focus',load);
    };
  },[userId,page,revision]);

  const current = data.owner===userId
    ? data
    : {
        items:[],
        count:0,
        loading:true,
        error:''
      };

  return {
    ...current,
    refresh:()=>setRevision(v=>v+1)
  };
}

function notificationTime(value) {
  return new Date(value).toLocaleString('en-MY',{
    timeZone:'Asia/Kuala_Lumpur',
    day:'numeric',
    month:'short',
    year:'numeric',
    hour:'numeric',
    minute:'2-digit'
  });
}

export default function Notifications({
  feed,onOpen
}) {
  const [unreadOnly,setUnreadOnly] = useState(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');

  const items = unreadOnly
    ? feed.items.filter(n=>!n.read_at)
    : feed.items;

  async function select(n) {
    if(busy) return;

    setBusy(true);
    setError('');

    try {
      if(!n.read_at) {
        await markNotificationRead(n.id);
        feed.refresh();
      }

      await onOpen(n.work_order_id);

    } catch(err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function readAll() {
    if(busy) return;

    setBusy(true);
    setError('');

    try {
      await markAllNotificationsRead();
      feed.refresh();
    } catch(err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel notification-panel">
      <PushSettings/>

      <div className="notification-toolbar">

        <div className="notification-tabs">
          <button
            className={!unreadOnly?'active':''}
            onClick={()=>setUnreadOnly(false)}
          >
            All
          </button>

          <button
            className={unreadOnly?'active':''}
            onClick={()=>setUnreadOnly(true)}
          >
            Unread ({feed.count})
          </button>
        </div>

        <button
          className="btn small"
          disabled={busy||!feed.count}
          onClick={readAll}
        >
          <CheckCheck size={17}/>
          Mark all as read
        </button>

      </div>

      {(error||feed.error)&&
        <p className="notification-error" role="alert">
          {error||feed.error}
        </p>
      }

      {feed.loading&&
        <div className="empty">
          Loading notifications...
        </div>
      }

      {!feed.loading&&!items.length&&!feed.error&&
        <div className="empty notification-empty">
          <Bell size={32}/>
          <strong>
            {unreadOnly
              ?'You are all caught up'
              :'No notifications yet'}
          </strong>
          <span>
            New work order updates will appear here.
          </span>
        </div>
      }

      {items.map(n=>{
        const Icon = icons[n.event_type]||Bell;

        return (
          <button
            type="button"
            key={n.id}
            disabled={busy}
            className={
              'notification-item '+
              (!n.read_at?'unread':'')
            }
            onClick={()=>select(n)}
          >
            <div className="notification-icon">
              <Icon size={21}/>
            </div>

            <div className="notification-content">
              <strong>{n.title}</strong>
              <span>{n.message}</span>
              <small>
                {notificationTime(n.created_at)}
              </small>
            </div>

            {!n.read_at&&
              <span className="notification-dot"/>
            }

            <ChevronRight size={17}/>

          </button>
        );
      })}

    </section>
  );
}
