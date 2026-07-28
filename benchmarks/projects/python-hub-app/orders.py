from hub import get_db_connection, log, Config


def place_order(user_id, items):
    conn = get_db_connection()
    log(f"placing order for {user_id}: {items}")
    return {"user_id": user_id, "items": items, "connection": conn}


def cancel_order(order_id, config=Config()):
    log(f"cancelling order {order_id} in {config.env}")
    return get_db_connection()
