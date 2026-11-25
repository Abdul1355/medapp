def calculate_bmi(weight_kg, height_cm):
    if weight_kg <= 0 or height_cm <= 0:
        raise ValueError("Invalid measurements")
    return round(weight_kg / ((height_cm / 100) ** 2), 2)

def test_bmi():
    assert calculate_bmi(70, 175) == 22.86
