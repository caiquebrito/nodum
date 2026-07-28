from hub import get_db_connection, log


def create_user(name):
    conn = get_db_connection()
    log(f"creating user {name}")
    return {"name": name, "connection": conn}


def delete_user(user_id):
    conn = get_db_connection()
    log(f"deleting user {user_id}")
    return conn
