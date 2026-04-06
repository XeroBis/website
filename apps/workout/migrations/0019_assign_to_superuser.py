from django.db import migrations


def assign_to_superuser(apps, schema_editor):
    User = apps.get_model("auth", "User")
    superuser = User.objects.filter(is_superuser=True).first()
    if superuser:
        apps.get_model("workout", "Workout").objects.filter(user=None).update(
            user=superuser
        )
        apps.get_model("workout", "WorkoutTemplate").objects.filter(user=None).update(
            user=superuser
        )


class Migration(migrations.Migration):

    dependencies = [
        ("workout", "0018_add_user_nullable"),
    ]

    operations = [
        migrations.RunPython(assign_to_superuser, migrations.RunPython.noop),
    ]
