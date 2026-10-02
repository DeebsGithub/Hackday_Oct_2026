from snowflake import connector
from dotenv import load_dotenv
import os

load_dotenv()


def load_database():
    conn = connector.connect(
        account=os.environ['SNOWFLAKE_ACCOUNT'],
        user=os.environ['SNOWFLAKE_USER'],
        password=os.environ['SNOWFLAKE_PASSWORD'],
        role=os.environ["SNOWFLAKE_ROLE"],
        warehouse="SNOWFLAKE_LEARNING_WH",
        database="CIRIUM_FLIGHT_DATA",
        schema="PUBLIC",
    )

    cur = conn.cursor()
    cur.execute("SELECT * LIMIT 10;")
    print(cur.fetchall())


if __name__ == "__main__":
    load_database()
