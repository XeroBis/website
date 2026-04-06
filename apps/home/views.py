import os
import tempfile

from django.contrib.auth.decorators import login_required
from django.core.management import call_command
from django.http import HttpResponse, JsonResponse
from django.shortcuts import redirect, render
from django.utils import translation

from .models import Projet, Testimonial


def home(request):
    """
    View pour afficher la page d'accueil.
    """
    lang = translation.get_language()

    projets = Projet.objects.prefetch_related("tags").all()
    testimonial = Testimonial.objects.all()
    context = {
        "page": "home",
        "projets": projets,
        "lang": lang,
        "testimonials": testimonial,
    }
    return render(request, "home/home.html", context)


@login_required
def download_data_json(request):
    temp_file_path = None
    try:
        # Create a temporary file to store the exported data
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False
        ) as temp_file:
            temp_file_path = temp_file.name

        # Call the management command to export data
        call_command("download_home_data", file=temp_file_path)

        # Read the generated file and return as response
        with open(temp_file_path, "r", encoding="utf-8") as f:
            data_content = f.read()

        response = HttpResponse(data_content, content_type="application/json")
        response["Content-Disposition"] = "attachment; filename=data.json"
        return response

    except Exception as e:
        return JsonResponse({"error": f"Export failed: {str(e)}"}, status=500)
    finally:
        if temp_file_path and os.path.exists(temp_file_path):
            os.unlink(temp_file_path)


@login_required
def import_data_json(request):
    if request.method == "POST" and request.FILES.get("file"):
        try:
            json_file = request.FILES["file"]

            # Create a temporary file to store the uploaded JSON
            with tempfile.NamedTemporaryFile(
                mode="wb", suffix=".json", delete=False
            ) as temp_file:
                for chunk in json_file.chunks():
                    temp_file.write(chunk)
                temp_file_path = temp_file.name

            # Call the management command to import data
            call_command("import_home_data", file=temp_file_path)

            # Clean up the temporary file
            os.unlink(temp_file_path)

            return redirect("home")

        except Exception as e:
            # Clean up the temporary file if it exists
            if "temp_file_path" in locals():
                try:
                    os.unlink(temp_file_path)
                except OSError:
                    # File deletion failed, but we can continue
                    # as the error is already being reported
                    pass
            return JsonResponse({"error": f"Import failed: {str(e)}"}, status=400)

    return JsonResponse({"error": "Invalid request"}, status=400)


@login_required
def reset_data(request):
    try:
        call_command("clear_home_data")
        return redirect("home")
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=400)
