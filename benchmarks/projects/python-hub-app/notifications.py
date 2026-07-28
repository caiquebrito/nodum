from hub import log


def notify_user(user_id, message):
    log(f"notifying {user_id}: {message}")
    return True
