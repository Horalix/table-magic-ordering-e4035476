package net.lasoul.waiterapp;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;

import androidx.annotation.NonNull;

import com.google.androidbrowserhelper.trusted.DelegationService;

/**
 * Shows the waiter screen's alerts as this app's own, loud enough for a
 * restaurant.
 *
 * The waiter screen is a web page, and its alerts for a new order, a guest
 * calling and a bill request are web notifications (public/sw-push.js). In a
 * browser they land on the browser's one channel for the site: default
 * importance, the tablet's ordinary notification sound, no banner over
 * another app. Here Chrome hands each alert to this service instead, and it
 * goes out on a channel made for service:
 *
 *   "Orders, calls and bills": high importance (a banner over whatever is on
 *   screen, shown on the lock screen), the app's own chime (res/raw/table_alert,
 *   three rising notes, twice) and a long vibration. The waiter can change
 *   the sound or silence it in Android's settings for the app; Android keeps
 *   their choice.
 *
 *   "While the waiter screen is open": no sound. The page marks an alert
 *   silent when a waiter screen is open and in front, because the page is
 *   already ringing; it must not ring twice.
 *
 * Everything else (who is asked, what the alert says, opening the app on a
 * tap) is the library's, unchanged.
 */
public class TableAlertService extends DelegationService {

    /** Channel ids are for good: Android remembers the waiter's settings by id. */
    static final String CHANNEL_ALERTS = "table_alerts";
    static final String CHANNEL_QUIET = "table_alerts_quiet";

    /** Wait, buzz, pause, buzz, pause, long buzz: told apart from a message in a pocket. */
    private static final long[] VIBRATION = {0, 400, 150, 400, 150, 700};

    @Override
    public boolean onNotifyNotificationWithChannel(
            @NonNull String platformTag,
            int platformId,
            @NonNull Notification notification,
            @NonNull String channelName) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            // Before Android 8 there are no channels; the library's way is the only way.
            return super.onNotifyNotificationWithChannel(platformTag, platformId, notification, channelName);
        }

        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null || !manager.areNotificationsEnabled()) return false;
        ensureChannels(manager);

        boolean quiet = isSilent(notification);
        String channelId = quiet ? CHANNEL_QUIET : CHANNEL_ALERTS;
        if (isBlocked(manager, channelId)) return false;

        Notification.Builder builder = Notification.Builder.recoverBuilder(this, notification);
        builder.setChannelId(channelId);
        // The table and what it wants are for the waiter to read without unlocking.
        builder.setVisibility(Notification.VISIBILITY_PUBLIC);
        if (!quiet) builder.setGroupAlertBehavior(Notification.GROUP_ALERT_ALL);
        manager.notify(platformTag, platformId, builder.build());
        return true;
    }

    @Override
    public boolean onAreNotificationsEnabled(@NonNull String channelName) {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null || !manager.areNotificationsEnabled()) return false;
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true;
        // The page asks before it subscribes: it is the loud channel that decides.
        return !isBlocked(manager, CHANNEL_ALERTS);
    }

    /**
     * A web notification made with `silent: true` reaches Android asking that
     * only its group's summary may alert, and it is not that summary.
     */
    static boolean isSilent(Notification notification) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false;
        boolean summary = (notification.flags & Notification.FLAG_GROUP_SUMMARY) != 0;
        return !summary && notification.getGroupAlertBehavior() == Notification.GROUP_ALERT_SUMMARY;
    }

    private static boolean isBlocked(NotificationManager manager, String channelId) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false;
        NotificationChannel channel = manager.getNotificationChannel(channelId);
        return channel != null && channel.getImportance() == NotificationManager.IMPORTANCE_NONE;
    }

    /** Creating a channel that exists changes nothing: the waiter's own settings for it stay. */
    private void ensureChannels(NotificationManager manager) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;

        NotificationChannel alerts = new NotificationChannel(
                CHANNEL_ALERTS, getString(R.string.channel_alerts), NotificationManager.IMPORTANCE_HIGH);
        alerts.setDescription(getString(R.string.channel_alerts_description));
        alerts.setSound(
                Uri.parse("android.resource://" + getPackageName() + "/" + R.raw.table_alert),
                new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build());
        alerts.enableVibration(true);
        alerts.setVibrationPattern(VIBRATION);
        alerts.enableLights(true);
        alerts.setShowBadge(true);
        alerts.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        manager.createNotificationChannel(alerts);

        NotificationChannel quiet = new NotificationChannel(
                CHANNEL_QUIET, getString(R.string.channel_quiet), NotificationManager.IMPORTANCE_LOW);
        quiet.setDescription(getString(R.string.channel_quiet_description));
        quiet.setSound(null, null);
        quiet.enableVibration(false);
        quiet.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        manager.createNotificationChannel(quiet);
    }
}
